import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  DiscoveryQuery,
  ENDPOINT_PRICES_MICRO,
  SolanaAddress,
  SkuId,
  haversineMeters,
  keccak256HexUtf8,
  seedMerchantBySlug,
  verifyQuoteSignature,
  type MerchantPublic,
  type OrderState,
  type QuoteItem,
} from "@merchantmesh/shared";
import { nowSec, type MerchantDb, type MerchantRow, type InventoryRow } from "./db.js";
import { paymentGate, markFeeRefunded } from "./payments.js";
import {
  QuoteError,
  assertQuoteUsable,
  buildQuoteItems,
  counterOffer,
  createQuote,
  loadQuote,
  rowToSignedQuote,
} from "./quotes.js";
import { decideAndApplyDiscount } from "./pricingPolicy.js";
import { applyCampaignDiscount } from "./campaignPricing.js";
import type { DiscountDecisionProvider } from "./discountProvider.js";
import {
  commitStockForOrder,
  createOrder,
  createReservation,
  getOrder,
  transitionOrder,
  type OrderRow,
} from "./orders.js";
import { createMerchantStore, type MerchantStore } from "./store.js";
import type { MerchantChainClient } from "./chainClient.js";
import {
  getDb as getPgDb,
  getAcceptance,
  resolveAcceptance,
  getTaskOrderByTaskAndMerchant,
  listPendingAcceptancesWithContext,
  getMerchantOrgSlugById,
  getMerchantOrgIdBySlug,
  getTaskOrder as getPgTaskOrder,
  updateTaskOrderState,
  updateEscrowState,
  getEscrowByTaskOrder,
} from "@merchantmesh/db";

export interface MerchantAppConfig {
  db: MerchantDb;
  chain: MerchantChainClient;
  mockPayments: boolean;
  mockSecret: string;
  bridgeUrl: string;
  notifyBridge: boolean;
  /** Cluster display name for x402 payloads, e.g. "devnet"; "mock" in mock mode. */
  chainName: string;
  /** USDC mint address for x402 payloads; symbol placeholder in mock mode. */
  usdcAsset: string;
  /** DEMO_PREP_TIMEOUT: this shop never starts preparing → worker auto-refunds. */
  demoPrepTimeoutShop?: string;
  /** Short release deadline (seconds) used for the timeout-demo shop. */
  prepTimeoutSecs: number;
  /** Normal release deadline horizon (seconds). */
  releaseDeadlineSecs?: number;
  /** Delay before a funded order auto-transitions to preparing (ms). */
  autoPrepareDelayMs?: number;
  /** Delay after preparing before seeded agents mark the order ready (ms). */
  autoReadyDelayMs?: number;
  /** Faz J §2 — required (alongside usdcAsset as the mint) for real, non-mock payment verification. */
  rpc?: Rpc<SolanaRpcApi>;
  usdcMint?: Address;
  /** Faz 3 — proposes discounts for negotiation-enabled merchants' /quote calls; pricingPolicy.ts always clamps its output. */
  discountProvider: DiscountDecisionProvider;
}

type AppEnv = {
  Variables: {
    merchant: MerchantRow;
    rawBody: string;
    paymentId?: string;
  };
};

function parseBody<T extends z.ZodTypeAny>(raw: string, schema: T): z.infer<T> {
  const json = raw.trim() === "" ? {} : JSON.parse(raw);
  return schema.parse(json);
}

function merchantToPublic(m: MerchantRow, distanceM?: number): MerchantPublic {
  return {
    merchantId: m.merchant_id,
    slug: m.slug,
    name: m.name,
    category: m.category as MerchantPublic["category"],
    lat: m.lat,
    lng: m.lng,
    ...(distanceM !== undefined ? { distanceM } : {}),
    wallet: m.wallet as MerchantPublic["wallet"],
    qualityScore: m.quality_score,
    negotiation: !!m.negotiation_enabled,
    reservation: !!m.reservation_enabled,
    pickup: !!m.pickup,
    active: !!m.active,
    openingHours: m.opening_hours,
    verification: JSON.parse(m.verification_json),
    agentId: m.agent_id,
  };
}

export function createMerchantApp(cfg: MerchantAppConfig) {
  const db = cfg.db;
  const store = createMerchantStore(db);
  const releaseDeadlineSecs = cfg.releaseDeadlineSecs ?? 3600;
  const autoPrepareDelayMs = cfg.autoPrepareDelayMs ?? 800;
  const autoReadyDelayMs = cfg.autoReadyDelayMs ?? 2_500;
  const app = new Hono<AppEnv>();
  app.use("*", cors());

  const pendingTimers = new Set<NodeJS.Timeout>();

  function scheduleAutoReady(orderId: string): void {
    const timer = setTimeout(async () => {
      pendingTimers.delete(timer);
      try {
        const order = getOrder(db, orderId);
        if (!order || order.state !== "preparing" || order.escrow_order_id === null) return;
        const merchant = (await store.getMerchant(String(order.merchant_id)))!;
        const { txRef } = await cfg.chain.markReady(order.escrow_order_id, merchant.signer_key);
        const updated = transitionOrder(db, orderId, "ready");
        await notifyBridge(updated, { txRef });
      } catch (err) {
        console.error(`[merchants] auto-ready failed for ${orderId}:`, err);
      }
    }, autoReadyDelayMs);
    timer.unref?.();
    pendingTimers.add(timer);
  }

  function pgScheduleAutoReady(taskId: string, orderId: string): void {
    const timer = setTimeout(async () => {
      pendingTimers.delete(timer);
      try {
        const pgDb = getPgDb();
        const order = await getPgTaskOrder(pgDb, orderId);
        if (!order || order.state !== "preparing") return;
        const escrow = await getEscrowByTaskOrder(pgDb, orderId);
        if (!escrow || escrow.escrowOrderId === null) return;
        const slug = await getMerchantOrgSlugById(pgDb, order.merchantId);
        const merchant = slug ? await store.getMerchant(slug) : undefined;
        if (!merchant) return;
        const { txRef } = await cfg.chain.markReady(Number(escrow.escrowOrderId), merchant.signer_key);
        await updateTaskOrderState(pgDb, orderId, "ready");
        await notifyBridgePg(taskId, orderId, "ready", { txRef });
      } catch (err) {
        console.error(`[merchants] pg auto-ready failed for ${orderId}:`, err);
      }
    }, autoReadyDelayMs);
    timer.unref?.();
    pendingTimers.add(timer);
  }

  async function notifyBridge(order: OrderRow, extra: Record<string, unknown> = {}): Promise<void> {
    if (!cfg.notifyBridge) return;
    const merchant = await store.getMerchant(String(order.merchant_id));
    try {
      await fetch(`${cfg.bridgeUrl}/internal/order-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskId: order.task_id,
          orderId: order.order_id,
          merchantId: order.merchant_id,
          merchantSlug: merchant?.slug,
          merchantName: merchant?.name,
          state: order.state,
          escrowOrderId: order.escrow_order_id,
          ...extra,
        }),
      });
    } catch {
      // Bridge offline is non-fatal for the merchant.
    }
  }

  /** Faz I §5 — same notification, for a Postgres-tracked task_order (bridge's handleOrderEvent is dual-path too). */
  async function notifyBridgePg(taskId: string, orderId: string, state: string, extra: Record<string, unknown> = {}): Promise<void> {
    if (!cfg.notifyBridge) return;
    try {
      await fetch(`${cfg.bridgeUrl}/internal/order-events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId, orderId, state, ...extra }),
      });
    } catch {
      // Bridge offline is non-fatal for the merchant.
    }
  }

  function scheduleAutoPrepare(orderId: string): void {
    const timer = setTimeout(async () => {
      pendingTimers.delete(timer);
      try {
        const order = getOrder(db, orderId);
        if (!order || order.state !== "paid_in_escrow" || order.escrow_order_id === null) return;
        const orderMerchant = (await store.getMerchant(String(order.merchant_id)))!;
        const { txRef } = await cfg.chain.markPreparing(order.escrow_order_id, orderMerchant.signer_key);
        const updated = transitionOrder(db, orderId, "preparing");
        await notifyBridge(updated, { txRef });
        scheduleAutoReady(orderId);
      } catch (err) {
        console.error(`[merchants] auto-prepare failed for ${orderId}:`, err);
      }
    }, autoPrepareDelayMs);
    timer.unref?.();
    pendingTimers.add(timer);
  }

  /** Faz I §5 — same auto-prepare, for a Postgres-tracked task_order/escrow pair. */
  function pgScheduleAutoPrepare(taskId: string, orderId: string): void {
    const timer = setTimeout(async () => {
      pendingTimers.delete(timer);
      try {
        const pgDb = getPgDb();
        const order = await getPgTaskOrder(pgDb, orderId);
        if (!order || order.state !== "paid_in_escrow") return;
        const escrow = await getEscrowByTaskOrder(pgDb, orderId);
        if (!escrow || escrow.escrowOrderId === null) return;
        const slug = await getMerchantOrgSlugById(pgDb, order.merchantId);
        const merchant = slug ? await store.getMerchant(slug) : undefined;
        if (!merchant) return;
        const { txRef } = await cfg.chain.markPreparing(Number(escrow.escrowOrderId), merchant.signer_key);
        await updateTaskOrderState(pgDb, orderId, "preparing");
        await notifyBridgePg(taskId, orderId, "preparing", { txRef });
        pgScheduleAutoReady(taskId, orderId);
      } catch (err) {
        console.error(`[merchants] pg auto-prepare failed for ${orderId}:`, err);
      }
    }, autoPrepareDelayMs);
    timer.unref?.();
    pendingTimers.add(timer);
  }

  // -------------------------------------------------------------------------
  // Health + discovery (free)
  // -------------------------------------------------------------------------
  app.get("/health", (c) => c.json({ ok: true, service: "merchant-agents" }));

  app.get("/discovery", async (c) => {
    const query = DiscoveryQuery.safeParse({
      lat: c.req.query("lat"),
      lng: c.req.query("lng"),
      radius: c.req.query("radius") ?? undefined,
    });
    if (!query.success) return c.json({ error: "invalid_query", issues: query.error.issues }, 400);
    const { lat, lng, radius } = query.data;
    const rows = await store.listActiveMerchants();
    const result = rows
      .map((m) => merchantToPublic(m, haversineMeters(lat, lng, m.lat, m.lng)))
      .filter((m) => (m.distanceM ?? Infinity) <= radius)
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
    return c.json({ merchants: result, count: result.length });
  });

  // -------------------------------------------------------------------------
  // Paid endpoints — every merchant endpoint is x402-gated
  // -------------------------------------------------------------------------
  const gate = (endpoint: keyof typeof ENDPOINT_PRICES_MICRO) =>
    paymentGate(endpoint, {
      db,
      store,
      mockPayments: cfg.mockPayments,
      mockSecret: cfg.mockSecret,
      chainName: cfg.chainName,
      usdcAsset: cfg.usdcAsset,
      rpc: cfg.rpc,
      usdcMint: cfg.usdcMint,
    });

  const AskBody = z.object({
    question: z.string().min(1).max(500),
    kind: z.enum(["general", "quality-evidence"]).default("general"),
  });

  app.post("/merchant/:id/ask", gate("ask"), (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), AskBody);
    if (body.kind === "quality-evidence") {
      // Deterministic quality oracle straight from the merchant record.
      return c.json({
        merchant: merchant.name,
        kind: body.kind,
        qualityScore: merchant.quality_score,
        evidence: [
          `Registered quality score: ${merchant.quality_score}/10`,
          `Verification: ${merchant.verification_json}`,
          `Opening hours: ${merchant.opening_hours}`,
        ],
        answer: `${merchant.name} has a quality score of ${merchant.quality_score}/10.`,
      });
    }
    return c.json({
      merchant: merchant.name,
      kind: body.kind,
      answer: `${merchant.name} (${merchant.category}) — opening hours ${merchant.opening_hours}. Pickup: ${merchant.pickup ? "available" : "unavailable"}.`,
    });
  });

  const InventoryBody = z.object({ skus: z.array(SkuId).optional() });

  app.post("/merchant/:id/inventory", gate("inventory"), async (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), InventoryBody);
    const rows = await store.getInventory(merchant.merchant_id, body.skus);
    return c.json({
      merchant: merchant.name,
      inventory: rows.map((r) => ({ sku: r.sku, priceMicroUsdc: r.price_micro, stockQty: r.stock_qty })),
    });
  });

  const QuoteBody = z.object({
    items: z.array(z.object({ sku: SkuId, qty: z.number().int().positive().max(100) })).min(1),
    taskId: z.string().optional(),
  });

  app.post("/merchant/:id/quote", gate("quote"), async (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), QuoteBody);
    // Partial quotes: skip items this shop doesn't stock (or can't cover) and
    // report them as omitted — general stores get the whole list and answer
    // with what they actually carry.
    const available: { sku: string; qty: number }[] = [];
    const omittedSkus: string[] = [];
    const stockHints: Record<string, number> = {};
    for (const item of body.items) {
      const inv = await store.getInventoryItem(merchant.merchant_id, item.sku);
      if (!inv || inv.stock_qty < item.qty) {
        omittedSkus.push(item.sku);
        continue;
      }
      available.push(item);
      stockHints[item.sku] = inv.stock_qty;
    }
    if (available.length === 0) {
      return c.json({ error: "sku_not_stocked", detail: "None of the requested items are in stock here.", omittedSkus }, 422);
    }
    try {
      // Campaign discounts (deterministic, merchant-configured — see
      // campaignPricing.ts) apply first, live mode only. Faz 3's LLM-assisted
      // negotiation discount (always clamped by pricingPolicy.ts) then
      // composes on top of the campaign-discounted baseline, each layer
      // independently floor-protected. Non-negotiating merchants with no
      // active campaign skip both calls entirely.
      let quoteOverrides: { totalMicroUsdc: number; items: QuoteItem[] } | undefined;
      const pgDb = process.env.DATABASE_URL ? getPgDb() : undefined;
      const base = await buildQuoteItems(store, merchant, available);
      const campaignResult = await applyCampaignDiscount(pgDb, store, merchant, base.items, base.total);
      if (campaignResult.discountMicroUsdc > 0) {
        quoteOverrides = { totalMicroUsdc: campaignResult.totalMicroUsdc, items: campaignResult.items };
      }
      if (merchant.negotiation_enabled) {
        const decided = await decideAndApplyDiscount(
          pgDb,
          store,
          cfg.discountProvider,
          merchant,
          campaignResult.items,
          campaignResult.totalMicroUsdc,
        );
        quoteOverrides = { totalMicroUsdc: decided.totalMicroUsdc, items: decided.items };
      }
      const quote = await createQuote(db, store, merchant, available, body.taskId, quoteOverrides);
      return c.json({ quote, stockHints, omittedSkus });
    } catch (err) {
      if (err instanceof QuoteError) return c.json({ error: err.code, detail: err.message }, 422);
      throw err;
    }
  });

  /**
   * Faz J §3 — consolidates quote + the quality-evidence half of `ask` into
   * one paid call: signed quote, stock hints, quality score (deterministic,
   * from the merchant record — never LLM-produced), prep time, and per-sku
   * reservation eligibility. `prepTimeMin` is a fixed default here (Faz A's
   * Postgres schema has a real per-merchant `merchant_settings.prep_time_min`
   * column, but the SQLite mock schema has no equivalent field, and adding
   * one is out of scope for this pass — documented in DECISIONS.md).
   */
  app.post("/merchant/:id/quote-basket", gate("quote-basket"), async (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), QuoteBody);
    const available: { sku: string; qty: number }[] = [];
    const omittedSkus: string[] = [];
    const stockHints: Record<string, number> = {};
    for (const item of body.items) {
      const inv = await store.getInventoryItem(merchant.merchant_id, item.sku);
      if (!inv || inv.stock_qty < item.qty) {
        omittedSkus.push(item.sku);
        continue;
      }
      available.push(item);
      stockHints[item.sku] = inv.stock_qty;
    }
    if (available.length === 0) {
      return c.json({ error: "sku_not_stocked", detail: "None of the requested items are in stock here.", omittedSkus }, 422);
    }
    try {
      const quote = await createQuote(db, store, merchant, available, body.taskId);
      const reservationEligible: Record<string, boolean> = {};
      if (merchant.reservation_enabled) {
        for (const item of available) {
          const stock = stockHints[item.sku] ?? 0;
          reservationEligible[item.sku] = stock - item.qty <= 1; // "scarce" — same heuristic reserveScarceStock used
        }
      }
      return c.json({
        quote,
        stockHints,
        omittedSkus,
        qualityScore: merchant.quality_score,
        evidence: [
          `Registered quality score: ${merchant.quality_score}/10`,
          `Verification: ${merchant.verification_json}`,
          `Opening hours: ${merchant.opening_hours}`,
        ],
        prepTimeMin: 15,
        reservationEligible,
      });
    } catch (err) {
      if (err instanceof QuoteError) return c.json({ error: err.code, detail: err.message }, 422);
      throw err;
    }
  });

  const NegotiateBody = z.object({
    quoteId: z.string(),
    requestedDiscountBps: z.number().int().min(1).max(3000),
    taskId: z.string().optional(),
  });

  app.post("/merchant/:id/negotiate", gate("negotiate"), async (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), NegotiateBody);
    const fee = ENDPOINT_PRICES_MICRO.negotiate;

    if (!merchant.negotiation_enabled) {
      markFeeRefunded(c, db);
      return c.json({ accepted: false, reason: "negotiation_not_supported", feeRefunded: true });
    }
    const row = loadQuote(db, body.quoteId);
    if (!row || row.merchant_id !== merchant.merchant_id) {
      markFeeRefunded(c, db);
      return c.json({ accepted: false, reason: "quote_not_found", feeRefunded: true }, 404);
    }
    try {
      assertQuoteUsable(row);
    } catch (err) {
      markFeeRefunded(c, db);
      return c.json({ accepted: false, reason: (err as QuoteError).code, feeRefunded: true }, 422);
    }

    const counter = await counterOffer(store, merchant, row, body.requestedDiscountBps);
    if (counter.discountMicroUsdc < fee) {
      // Discount smaller than the negotiation fee → auto-refund the fee,
      // original quote stays active.
      markFeeRefunded(c, db);
      return c.json({
        accepted: false,
        reason: "discount_below_fee",
        discountMicroUsdc: counter.discountMicroUsdc,
        feeMicroUsdc: fee,
        feeRefunded: true,
      });
    }
    const newQuote = await createQuote(db, store, merchant, [], body.taskId ?? row.task_id ?? undefined, {
      items: counter.newItems,
      totalMicroUsdc: counter.newTotal,
      supersedes: row.quote_id,
    });
    return c.json({
      accepted: true,
      quote: newQuote,
      supersededQuoteId: row.quote_id,
      discountMicroUsdc: counter.discountMicroUsdc,
      counterBps: counter.counterBps,
      feeRefunded: false,
    });
  });

  const ReserveBody = z.object({
    sku: SkuId,
    qty: z.number().int().positive().max(100),
    quoteId: z.string().optional(),
    taskId: z.string().optional(),
  });

  app.post("/merchant/:id/reserve", gate("reserve"), async (c) => {
    const merchant = c.get("merchant");
    const body = parseBody(c.get("rawBody"), ReserveBody);
    if (!merchant.reservation_enabled) {
      return c.json({ error: "reservation_not_supported" }, 422);
    }
    try {
      const r = await createReservation(store, merchant.merchant_id, body.sku, body.qty, merchant.reservation_ttl, body.quoteId);
      return c.json({
        reservationId: r.reservation_id,
        sku: r.sku,
        qty: r.qty,
        expiresAt: r.expires_at,
        ttlSeconds: merchant.reservation_ttl,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
  });

  const OrderBody = z.object({
    quoteId: z.string(),
    taskId: z.string(),
    buyer: SolanaAddress,
    pickupCodeHash: z.string().regex(/^[0-9a-fA-F]{64}$/),
    /** Optional subset of the signed quote's items (partial fulfillment). */
    items: z.array(z.object({ sku: SkuId, qty: z.number().int().positive() })).optional(),
  });

  // Faz J §3 — free: order creation now happens through the (also free)
  // acceptance flow in the real path (Faz I); this endpoint is only still
  // called by the mock fast-forward path (no gate("order") — ENDPOINT_PRICES_MICRO
  // dropped the `order` price entirely).
  app.post("/merchant/:id/order", async (c) => {
    const merchant = await store.getMerchant(c.req.param("id") ?? "");
    if (!merchant || !merchant.active) return c.json({ error: "merchant_not_found" }, 404);
    const body = parseBody(await c.req.text(), OrderBody);
    const row = loadQuote(db, body.quoteId);
    if (!row || row.merchant_id !== merchant.merchant_id) {
      return c.json({ error: "quote_not_found" }, 404);
    }
    try {
      assertQuoteUsable(row);
    } catch (err) {
      return c.json({ error: (err as QuoteError).code, detail: (err as QuoteError).message }, 422);
    }
    // Re-verify the EIP-712 signature against the merchant's registered wallet
    // before anything is committed — expired/superseded/tampered quotes never
    // reach escrow funding.
    const signed = rowToSignedQuote(row, merchant.wallet);
    if (!(await verifyQuoteSignature(signed))) {
      return c.json({ error: "quote_signature_invalid" }, 422);
    }
    // Ordered items: either the full signed quote, or a subset of it. Unit
    // prices ALWAYS come from the signed quote — never from the request.
    const quoteItems: QuoteItem[] = JSON.parse(row.items_json);
    let items: QuoteItem[];
    if (body.items) {
      items = [];
      for (const req of body.items) {
        const qi = quoteItems.find((q) => q.sku === req.sku);
        if (!qi || req.qty > qi.qty) {
          return c.json({ error: "order_items_not_in_quote", detail: `${req.sku} x${req.qty} exceeds the signed quote` }, 422);
        }
        items.push({ sku: req.sku, qty: req.qty, unitPriceMicroUsdc: qi.unitPriceMicroUsdc });
      }
      if (items.length === 0) return c.json({ error: "order_items_empty" }, 422);
    } else {
      items = quoteItems;
    }
    try {
      await commitStockForOrder(store, merchant.merchant_id, items);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 422);
    }
    db.prepare("UPDATE quotes SET status = 'consumed' WHERE quote_id = ?").run(row.quote_id);
    const orderTotal = items.reduce((s, i) => s + i.unitPriceMicroUsdc * i.qty, 0);
    const deadlineSecs = cfg.demoPrepTimeoutShop === merchant.slug ? cfg.prepTimeoutSecs : releaseDeadlineSecs;
    const order = createOrder(db, {
      merchantId: merchant.merchant_id,
      quoteId: row.quote_id,
      taskId: body.taskId,
      buyer: body.buyer,
      items,
      totalMicroUsdc: orderTotal,
      pickupCodeHash: body.pickupCodeHash,
      releaseDeadline: nowSec() + deadlineSecs,
    });
    return c.json({
      orderId: order.order_id,
      totalMicroUsdc: order.total_micro,
      releaseDeadline: order.release_deadline,
      state: order.state,
    });
  });

  // -------------------------------------------------------------------------
  // Internal webhook from the bridge: escrow funded on-chain
  // -------------------------------------------------------------------------
  const EscrowFundedBody = z.object({
    orderId: z.string(),
    escrowOrderId: z.number().int(),
    txRef: z.string(),
  });

  app.post("/internal/escrow-funded", async (c) => {
    const body = EscrowFundedBody.parse(await c.req.json());
    const order = getOrder(db, body.orderId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    db.prepare("UPDATE orders SET escrow_order_id = ?, escrow_tx = ? WHERE order_id = ?").run(
      body.escrowOrderId, body.txRef, body.orderId,
    );
    const updated = transitionOrder(db, body.orderId, "paid_in_escrow");
    const merchant = db.prepare("SELECT slug FROM merchants WHERE merchant_id = ?").get(order.merchant_id) as { slug: string };
    if (cfg.demoPrepTimeoutShop === merchant.slug) {
      console.warn(`[merchants] DEMO_PREP_TIMEOUT: ${merchant.slug} will never start preparing (auto-refund demo).`);
    } else {
      scheduleAutoPrepare(body.orderId);
    }
    return c.json({ ok: true, state: updated.state });
  });

  // Faz I §5 — same webhook, for the Postgres acceptance-flow path: called
  // by the bridge once it has verified the user's own wallet actually
  // funded the escrow on-chain (see orchestrator.verifyFunding). Replaces
  // /internal/escrow-funded for orders that went through /console/acceptances.
  const OrderFundedBody = z.object({
    orderId: z.string(),
    escrowOrderId: z.number().int(),
    txSignature: z.string(),
    merchantSlug: z.string().optional(),
  });

  app.post("/internal/order-funded", async (c) => {
    if (!process.env.DATABASE_URL) return c.json({ error: "postgres_required" }, 501);
    const body = OrderFundedBody.parse(await c.req.json());
    const pgDb = getPgDb();
    const order = await getPgTaskOrder(pgDb, body.orderId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    const slug = body.merchantSlug ?? (await getMerchantOrgSlugById(pgDb, order.merchantId));
    if (cfg.demoPrepTimeoutShop === slug) {
      console.warn(`[merchants] DEMO_PREP_TIMEOUT: ${slug} will never start preparing (auto-refund demo, Postgres path).`);
    } else {
      pgScheduleAutoPrepare(order.taskId, order.id);
    }
    return c.json({ ok: true });
  });

  // Internal: escrow funding reverted → cancel the order and restore stock.
  const CancelOrderBody = z.object({ orderId: z.string() });

  app.post("/internal/cancel-order", async (c) => {
    const body = CancelOrderBody.parse(await c.req.json());
    const order = getOrder(db, body.orderId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    if (order.state !== "awaiting_funding") return c.json({ error: "order_not_cancellable", state: order.state }, 422);
    await store.restock(order.merchant_id, JSON.parse(order.items_json) as QuoteItem[]);
    const updated = transitionOrder(db, body.orderId, "cancelled");
    return c.json({ ok: true, state: updated.state });
  });

  // Internal: buyer used the manual fallback release on-chain.
  const EscrowReleasedBody = z.object({ orderId: z.string(), txRef: z.string() });

  app.post("/internal/escrow-released", async (c) => {
    const body = EscrowReleasedBody.parse(await c.req.json());
    const order = getOrder(db, body.orderId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    if (order.state === "completed") return c.json({ ok: true, state: order.state });
    db.prepare("UPDATE orders SET release_tx = ? WHERE order_id = ?").run(body.txRef, body.orderId);
    if (order.state === "paid_in_escrow") transitionOrder(db, body.orderId, "preparing");
    if (getOrder(db, body.orderId)!.state === "preparing") transitionOrder(db, body.orderId, "ready");
    const updated = transitionOrder(db, body.orderId, "completed");
    return c.json({ ok: true, state: updated.state });
  });

  // -------------------------------------------------------------------------
  // Merchant console (the merchant's own UI — not agent-facing, not paid)
  // -------------------------------------------------------------------------
  app.get("/console/merchants", async (c) => {
    const rows = await store.listActiveMerchants();
    const merchants = await Promise.all(
      rows.map(async (m) => ({
        ...merchantToPublic(m),
        inventory: (await store.getInventory(m.merchant_id)).map((r) => ({
          sku: r.sku,
          priceMicroUsdc: r.price_micro,
          stockQty: r.stock_qty,
        })),
      })),
    );
    return c.json({ merchants });
  });

  app.get("/console/orders", async (c) => {
    const merchantFilter = c.req.query("merchantId");
    const rows = (
      merchantFilter
        ? db.prepare("SELECT * FROM orders WHERE merchant_id = ? ORDER BY created_at DESC").all(Number(merchantFilter))
        : db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all()
    ) as unknown as OrderRow[];
    const merchantRows = await store.listActiveMerchants();
    const merchants = new Map(merchantRows.map((m) => [m.merchant_id, m]));
    return c.json({
      orders: rows.map((o) => ({
        orderId: o.order_id,
        merchantId: o.merchant_id,
        merchantSlug: merchants.get(o.merchant_id)?.slug,
        merchantName: merchants.get(o.merchant_id)?.name,
        taskId: o.task_id,
        items: JSON.parse(o.items_json),
        totalMicroUsdc: o.total_micro,
        state: o.state,
        escrowOrderId: o.escrow_order_id,
        escrowTx: o.escrow_tx,
        releaseTx: o.release_tx,
        releaseDeadline: o.release_deadline,
        stateLog: JSON.parse(o.state_log_json),
        createdAt: o.created_at,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // Faz I §2 — merchant acceptance console. Requires Postgres (DATABASE_URL);
  // 501 in mock mode, matching the "not modeled yet in SQLite" scope call
  // from plans/faz-i.md §1 (merchant_acceptances/task_orders are Postgres-only).
  // -------------------------------------------------------------------------
  async function notifyAcceptanceResolved(params: {
    taskId: string;
    merchantSlug: string;
    orderId: string;
    decision: "accepted" | "rejected";
    reason?: string;
  }): Promise<void> {
    try {
      await fetch(`${cfg.bridgeUrl}/internal/acceptance-resolved`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(params),
      });
    } catch {
      // Bridge offline — the acceptance timeout worker will eventually re-drive the saga.
    }
  }

  app.get("/console/acceptances", async (c) => {
    if (!process.env.DATABASE_URL) return c.json({ acceptances: [] });
    const rows = await listPendingAcceptancesWithContext(getPgDb());
    return c.json({
      acceptances: rows.map((r) => ({
        acceptanceId: r.id,
        taskId: r.taskId,
        orderId: r.orderId,
        merchantSlug: r.merchantSlug,
        merchantName: r.merchantName,
        items: r.itemsJson,
        totalMicroUsdc: Number(r.totalMicroUsdc),
        expiresAt: Math.floor(r.expiresAt.getTime() / 1000),
        createdAt: Math.floor(r.createdAt.getTime() / 1000),
      })),
    });
  });

  const AcceptDecisionBody = z.object({ reason: z.string().max(200).optional() });

  app.post("/console/acceptances/:id/accept", async (c) => {
    if (!process.env.DATABASE_URL) return c.json({ error: "postgres_required" }, 501);
    const pgDb = getPgDb();
    const acceptance = await getAcceptance(pgDb, c.req.param("id"));
    if (!acceptance || acceptance.status !== "pending") return c.json({ error: "acceptance_not_found" }, 404);
    const order = await getTaskOrderByTaskAndMerchant(pgDb, acceptance.taskId, acceptance.merchantId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    const slug = (await getMerchantOrgSlugById(pgDb, acceptance.merchantId))!;
    const numericMerchantId = seedMerchantBySlug(slug).merchantId;
    const items = order.itemsJson as { sku: string; qty: number }[];

    try {
      await store.commitStockForOrder(numericMerchantId, items);
    } catch {
      await resolveAcceptance(pgDb, acceptance.id, "rejected", "out_of_stock");
      await notifyAcceptanceResolved({ taskId: acceptance.taskId, merchantSlug: slug, orderId: order.id, decision: "rejected", reason: "out_of_stock" });
      return c.json({ error: "out_of_stock" }, 422);
    }

    await resolveAcceptance(pgDb, acceptance.id, "accepted");
    await notifyAcceptanceResolved({ taskId: acceptance.taskId, merchantSlug: slug, orderId: order.id, decision: "accepted" });
    return c.json({ ok: true, orderId: order.id });
  });

  app.post("/console/acceptances/:id/reject", async (c) => {
    if (!process.env.DATABASE_URL) return c.json({ error: "postgres_required" }, 501);
    const pgDb = getPgDb();
    const body = AcceptDecisionBody.parse(await c.req.json().catch(() => ({})));
    const acceptance = await getAcceptance(pgDb, c.req.param("id"));
    if (!acceptance || acceptance.status !== "pending") return c.json({ error: "acceptance_not_found" }, 404);
    const order = await getTaskOrderByTaskAndMerchant(pgDb, acceptance.taskId, acceptance.merchantId);
    if (!order) return c.json({ error: "order_not_found" }, 404);
    const slug = (await getMerchantOrgSlugById(pgDb, acceptance.merchantId))!;

    await resolveAcceptance(pgDb, acceptance.id, "rejected", body.reason ?? "merchant_declined");
    await notifyAcceptanceResolved({ taskId: acceptance.taskId, merchantSlug: slug, orderId: order.id, decision: "rejected", reason: body.reason ?? "merchant_declined" });
    return c.json({ ok: true, orderId: order.id });
  });

  const ReadyBody = z.object({ orderId: z.string() });

  app.post("/merchant/:id/ready", async (c) => {
    const merchant = await store.getMerchant(c.req.param("id"));
    if (!merchant) return c.json({ error: "merchant_not_found" }, 404);
    const body = ReadyBody.parse(await c.req.json());

    const order = getOrder(db, body.orderId);
    if (order) {
      if (order.merchant_id !== merchant.merchant_id) return c.json({ error: "order_not_found" }, 404);
      if (order.state !== "preparing") return c.json({ error: "order_not_preparing", state: order.state }, 422);
      if (order.escrow_order_id === null) return c.json({ error: "order_not_funded" }, 422);
      const { txRef } = await cfg.chain.markReady(order.escrow_order_id, merchant.signer_key);
      const updated = transitionOrder(db, body.orderId, "ready");
      await notifyBridge(updated, { txRef });
      return c.json({ ok: true, state: updated.state, txRef });
    }

    // Faz I §5 — Postgres acceptance-flow order.
    if (!process.env.DATABASE_URL) return c.json({ error: "order_not_found" }, 404);
    const pgDb = getPgDb();
    const pgOrder = await getPgTaskOrder(pgDb, body.orderId);
    const merchantOrgId = await getMerchantOrgIdBySlug(pgDb, merchant.slug);
    if (!pgOrder || pgOrder.merchantId !== merchantOrgId) return c.json({ error: "order_not_found" }, 404);
    if (pgOrder.state !== "preparing") return c.json({ error: "order_not_preparing", state: pgOrder.state }, 422);
    const pgEscrow = await getEscrowByTaskOrder(pgDb, body.orderId);
    if (!pgEscrow || pgEscrow.escrowOrderId === null) return c.json({ error: "order_not_funded" }, 422);
    const { txRef } = await cfg.chain.markReady(Number(pgEscrow.escrowOrderId), merchant.signer_key);
    await updateTaskOrderState(pgDb, body.orderId, "ready");
    await notifyBridgePg(pgOrder.taskId, body.orderId, "ready", { txRef });
    return c.json({ ok: true, state: "ready", txRef });
  });

  const VerifyPickupBody = z.object({ orderId: z.string(), code: z.string().min(4).max(32) });

  app.post("/merchant/:id/verify-pickup", async (c) => {
    const merchant = await store.getMerchant(c.req.param("id"));
    if (!merchant) return c.json({ error: "merchant_not_found" }, 404);
    const body = VerifyPickupBody.parse(await c.req.json());

    let order = getOrder(db, body.orderId);
    if (order) {
      if (order.merchant_id !== merchant.merchant_id) return c.json({ error: "order_not_found" }, 404);
      if (order.state !== "ready" && order.state !== "preparing") {
        return c.json({ error: "order_not_ready", state: order.state }, 422);
      }
      if (order.escrow_order_id === null) return c.json({ error: "order_not_funded" }, 422);
      const escrowOrderId = order.escrow_order_id;
      if (keccak256HexUtf8(body.code) !== order.pickup_code_hash) {
        return c.json({ error: "pickup_code_invalid" }, 422);
      }
      if (order.state === "preparing") {
        const { txRef } = await cfg.chain.markReady(escrowOrderId, merchant.signer_key);
        order = transitionOrder(db, body.orderId, "ready");
        await notifyBridge(order, { txRef });
      }
      const { txRef, released } = await cfg.chain.confirmPickup(escrowOrderId, body.code, merchant.signer_key);
      if (!released) return c.json({ error: "escrow_release_failed" }, 502);
      db.prepare("UPDATE orders SET release_tx = ? WHERE order_id = ?").run(txRef, body.orderId);
      const updated = transitionOrder(db, body.orderId, "completed");
      await notifyBridge(updated, { txRef, released: true });
      return c.json({ ok: true, state: updated.state, txRef, released });
    }

    // Faz I §5 — Postgres acceptance-flow order.
    if (!process.env.DATABASE_URL) return c.json({ error: "order_not_found" }, 404);
    const pgDb = getPgDb();
    let pgOrder = await getPgTaskOrder(pgDb, body.orderId);
    const merchantOrgId = await getMerchantOrgIdBySlug(pgDb, merchant.slug);
    if (!pgOrder || pgOrder.merchantId !== merchantOrgId) return c.json({ error: "order_not_found" }, 404);
    if (pgOrder.state !== "ready" && pgOrder.state !== "preparing") {
      return c.json({ error: "order_not_ready", state: pgOrder.state }, 422);
    }
    const pgEscrow = await getEscrowByTaskOrder(pgDb, body.orderId);
    if (!pgEscrow || pgEscrow.escrowOrderId === null) return c.json({ error: "order_not_funded" }, 422);
    const escrowOrderId = Number(pgEscrow.escrowOrderId);
    if (keccak256HexUtf8(body.code) !== pgOrder.pickupCodeHash) {
      return c.json({ error: "pickup_code_invalid" }, 422);
    }
    if (pgOrder.state === "preparing") {
      const { txRef } = await cfg.chain.markReady(escrowOrderId, merchant.signer_key);
      await updateTaskOrderState(pgDb, body.orderId, "ready");
      await notifyBridgePg(pgOrder.taskId, body.orderId, "ready", { txRef });
      pgOrder = (await getPgTaskOrder(pgDb, body.orderId))!;
    }
    const { txRef, released } = await cfg.chain.confirmPickup(escrowOrderId, body.code, merchant.signer_key);
    if (!released) return c.json({ error: "escrow_release_failed" }, 502);
    await updateEscrowState(pgDb, body.orderId, "Released", { releaseTxHash: txRef });
    await updateTaskOrderState(pgDb, body.orderId, "completed");
    await notifyBridgePg(pgOrder.taskId, body.orderId, "completed", { txRef, released: true });
    return c.json({ ok: true, state: "completed", txRef, released });
  });

  // -------------------------------------------------------------------------
  // Timeout worker: quote expiry, reservation release, prep-timeout refunds
  // -------------------------------------------------------------------------
  async function tick(): Promise<{ expiredQuotes: number; releasedReservations: number; refundedOrders: number }> {
    const now = nowSec();
    const expiredQuotes = db
      .prepare("UPDATE quotes SET status = 'expired' WHERE status = 'active' AND valid_until <= ?")
      .run(now).changes as number;

    let releasedReservations = 0;
    try {
      releasedReservations = await store.releaseExpiredReservations();
    } catch (err) {
      console.error("[merchants] releaseExpiredReservations failed (store unreachable?):", err);
    }

    const overdue = db
      .prepare("SELECT * FROM orders WHERE state IN ('paid_in_escrow', 'preparing') AND release_deadline <= ?")
      .all(now) as unknown as OrderRow[];
    let refunded = 0;
    for (const order of overdue) {
      try {
        if (order.escrow_order_id !== null && "refund" in cfg.chain === false) {
          // handled below via bridge chain endpoint
        }
        const res = await fetch(`${cfg.bridgeUrl}/chain/refund`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ escrowOrderId: order.escrow_order_id, reason: "prep-timeout" }),
        });
        if (!res.ok) throw new Error(`chain refund failed: ${res.status}`);
        const { txRef } = (await res.json()) as { txRef: string };
        db.prepare("UPDATE orders SET release_tx = ? WHERE order_id = ?").run(txRef, order.order_id);
        const updated = transitionOrder(db, order.order_id, "refunded");
        await notifyBridge(updated, { txRef, note: "prep-timeout auto-refund" });
        refunded++;
      } catch (err) {
        console.error(`[merchants] prep-timeout refund failed for ${order.order_id}:`, err);
      }
    }
    return { expiredQuotes, releasedReservations, refundedOrders: refunded };
  }

  let workerTimer: NodeJS.Timeout | undefined;
  const worker = {
    start(intervalMs = 2000) {
      if (workerTimer) return;
      workerTimer = setInterval(() => void tick(), intervalMs);
      workerTimer.unref?.();
    },
    stop() {
      if (workerTimer) clearInterval(workerTimer);
      workerTimer = undefined;
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.clear();
    },
    tick,
  };

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation_failed", issues: err.issues }, 400);
    }
    console.error("[merchants] unhandled error:", err);
    return c.json({ error: "internal_error", detail: (err as Error).message }, 500);
  });

  return { app, worker };
}

import { randomInt, randomUUID } from "node:crypto";
import {
  ENDPOINT_PRICES_MICRO,
  MERCHANT_ACCEPT_WINDOW_SEC,
  MerchantPublic,
  ShoppingPlan,
  SignedQuote,
  bytesToHex,
  getSku,
  hashQuote,
  keccak256HexUtf8,
  microToUsdc,
  verifyQuoteSignature,
  type OptionKind,
  type OptionShop,
  type PlanItem,
  type QuoteItem,
  type Receipt,
  type ReceiptShop,
  type ShoppingOption,
  type TaskStatus,
} from "@merchantmesh/shared";
import { nowSec, type BridgeDb } from "./db.js";
import type { TaskEventBus } from "./events.js";
import type { LlmProvider } from "./llmProvider.js";
import { BudgetExceededError, paidFetch, type PaymentProvider } from "./paymentClient.js";
import type { ChainProvider } from "./chain.js";
import { buildOptions, type CandidateQuote } from "./options.js";
import {
  type Db,
  getMerchantOrgIdBySlug,
  createTaskOrderPending,
  getTaskOrder,
  getTaskOrderByTaskAndMerchant,
  listTaskOrdersForTask,
  updateTaskOrderState,
  createAcceptance,
  expireStaleAcceptances,
  createEscrowRow,
  restockAfterCancel,
  getMerchantOrgSlugById,
  getMerchantOrgNameById,
  quotesSeen,
  getPgTaskOwner,
  getAccountView,
  getEscrowByTaskOrder,
  updateEscrowState,
} from "@merchantmesh/db";

/** Faz I §2 — optional live-version acceptance/escrow support (Postgres). */
export interface OrchestratorPostgresSupport {
  db: Db;
}

export interface OrchestratorConfig {
  merchantsUrl: string;
  budgetTotalMicro: number;
  budgetPerRequestMicro: number;
  discoveryRadiusM: number;
  /** Escrow release deadline horizon (seconds) — Faz I §2's Postgres funding path. Defaults to PREP_DEADLINE_SEC. */
  releaseDeadlineSecs?: number;
  /** Devnet agent-market mode: merchant agents accept valid in-stock orders without a human console click. */
  autoAcceptMerchantOrders?: boolean;
}

interface TaskRow {
  task_id: string;
  prompt: string;
  status: TaskStatus;
  lat: number;
  lng: number;
  plan_json: string | null;
  discovery_json: string | null;
  options_json: string | null;
  selected_option: string | null;
  receipt_json: string | null;
  error: string | null;
  budget_total_micro: number;
  budget_per_request_micro: number;
  created_at: number;
}

export class Orchestrator {
  constructor(
    private db: BridgeDb,
    private bus: TaskEventBus,
    private llm: LlmProvider,
    private payments: PaymentProvider,
    private chain: ChainProvider,
    private cfg: OrchestratorConfig,
    private pg?: OrchestratorPostgresSupport,
  ) {}

  // -------------------------------------------------------------------------
  // Task lifecycle
  // -------------------------------------------------------------------------
  createTask(prompt: string, lat: number, lng: number): string {
    const taskId = `t_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO tasks (task_id, prompt, status, lat, lng, budget_total_micro, budget_per_request_micro, created_at) VALUES (?, ?, 'planning', ?, ?, ?, ?, ?)",
      )
      .run(taskId, prompt, lat, lng, this.cfg.budgetTotalMicro, this.cfg.budgetPerRequestMicro, nowSec());
    this.bus.emit(taskId, "task_created", { prompt, lat, lng, budgetMicroUsdc: this.cfg.budgetTotalMicro });
    return taskId;
  }

  getTask(taskId: string): TaskRow | undefined {
    return this.db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId) as TaskRow | undefined;
  }

  private setStatus(taskId: string, status: TaskStatus): void {
    this.db.prepare("UPDATE tasks SET status = ? WHERE task_id = ?").run(status, taskId);
    this.bus.emit(taskId, "status", { status });
  }

  private fail(taskId: string, error: string): void {
    this.db.prepare("UPDATE tasks SET status = 'failed', error = ? WHERE task_id = ?").run(error, taskId);
    this.bus.emit(taskId, "task_failed", { error });
  }

  /** Faz I §4 — Postgres-tracked orders/escrows/pending-acceptances, for the web funding wizard. Additive: never touches the mock `orders` shape above. */
  private async pgOrdersSnapshot(taskId: string) {
    const pg = this.pg;
    if (!pg) return undefined;
    const orders = await listTaskOrdersForTask(pg.db, taskId);
    const out = [];
    for (const o of orders) {
      const escrow = await getEscrowByTaskOrder(pg.db, o.id);
      const merchantSlug = await getMerchantOrgSlugById(pg.db, o.merchantId);
      const merchantName = (await getMerchantOrgNameById(pg.db, o.merchantId)) ?? merchantSlug;
      out.push({
        orderId: o.id,
        merchantId: o.merchantId,
        merchantSlug,
        merchantName,
        items: o.itemsJson,
        totalMicroUsdc: Number(o.totalMicroUsdc),
        state: o.state,
        essential: o.essential,
        note: o.note,
        escrow: escrow
          ? {
              chainId: escrow.chainId,
              buyerAddress: escrow.buyerAddress,
              amountMicroUsdc: Number(escrow.amountMicroUsdc),
              quoteHash: escrow.quoteHash,
              pickupCodeHash: escrow.pickupCodeHash,
              releaseDeadline: Math.floor(escrow.releaseDeadline.getTime() / 1000),
              state: escrow.state,
              escrowOrderId: escrow.escrowOrderId !== null ? Number(escrow.escrowOrderId) : null,
              fundTxHash: escrow.fundTxHash,
              releaseTxHash: escrow.releaseTxHash,
            }
          : null,
      });
    }
    return out;
  }

  async taskSnapshot(taskId: string) {
    const task = this.getTask(taskId);
    if (!task) return undefined;
    const orders = this.db
      .prepare("SELECT * FROM task_orders WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as any[];
    const dropped = this.db.prepare("SELECT * FROM dropped_shops WHERE task_id = ?").all(taskId) as any[];
    const pgOrders = await this.pgOrdersSnapshot(taskId);
    return {
      taskId: task.task_id,
      prompt: task.prompt,
      status: task.status,
      plan: task.plan_json ? JSON.parse(task.plan_json) : null,
      discovery: task.discovery_json ? JSON.parse(task.discovery_json) : null,
      options: task.options_json ? JSON.parse(task.options_json) : null,
      selectedOption: task.selected_option,
      receipt: task.receipt_json ? JSON.parse(task.receipt_json) : null,
      error: task.error,
      budget: this.payments.budget(taskId),
      wallet: { address: this.chain.walletAddress(), balanceMicroUsdc: await this.chain.walletBalanceMicroUsdc() },
      orders: orders.map((o) => ({
        orderId: o.order_id,
        merchantId: o.merchant_id,
        merchantSlug: o.merchant_slug,
        merchantName: o.merchant_name,
        items: JSON.parse(o.items_json),
        totalMicroUsdc: o.total_micro,
        state: o.state,
        essential: !!o.essential,
        pickupCode: o.pickup_code,
        escrowOrderId: o.escrow_order_id,
        escrowTx: o.escrow_tx,
        releaseTx: o.release_tx,
        note: o.note,
      })),
      droppedShops: dropped.map((d) => ({
        merchantSlug: d.merchant_slug,
        merchantName: d.merchant_name,
        items: JSON.parse(d.items_json),
        reason: d.reason,
      })),
      // Faz I §4 — only populated when Postgres is wired; the web funding
      // wizard reads this instead of `orders` for the real-mode task.
      pgOrders,
    };
  }

  // -------------------------------------------------------------------------
  // Research pipeline: plan → discover → quotes → micro-actions → options
  // -------------------------------------------------------------------------
  async preparePlan(taskId: string, correction?: string): Promise<void> {
    try {
      const task = this.getTask(taskId);
      if (!task) throw new Error("task not found");
      this.bus.emit(taskId, "plan_started", { provider: this.llm.name });
      const prompt = correction ? `${task.prompt}\nUser correction: ${correction}\nReturn the complete revised shopping list.` : task.prompt;
      const plan = await this.llm.plan(prompt);
      this.db.prepare("UPDATE tasks SET plan_json = ?, status = 'awaiting_list_approval' WHERE task_id = ?").run(JSON.stringify(plan), taskId);
      this.bus.emit(taskId, "plan_ready", { plan, awaitingApproval: true });
      this.bus.emit(taskId, "status", { status: "awaiting_list_approval" });
    } catch (err) {
      this.fail(taskId, err instanceof Error ? err.message : String(err));
    }
  }

  /** Finalizes only the product rows the user explicitly selected, then starts paid research. */
  approvePlan(taskId: string, selectedIndices: number[]): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== "awaiting_list_approval" || !task.plan_json) {
      throw new Error("plan_not_ready");
    }
    const plan = ShoppingPlan.parse(JSON.parse(task.plan_json));
    const selected = new Set(selectedIndices);
    const items = plan.items.filter((_, index) => selected.has(index));
    if (items.length === 0) throw new Error("select_at_least_one_product");
    if (selectedIndices.some((index) => index < 0 || index >= plan.items.length)) {
      throw new Error("invalid_plan_item_selection");
    }
    const approvedPlan = ShoppingPlan.parse({ ...plan, items });
    this.db.prepare("UPDATE tasks SET plan_json = ? WHERE task_id = ?").run(JSON.stringify(approvedPlan), taskId);
    this.bus.emit(taskId, "plan_approved", { plan: approvedPlan, selectedCount: items.length });
    void this.runResearch(taskId);
  }

  async runResearch(taskId: string): Promise<void> {
    try {
      const task = this.getTask(taskId);
      if (!task) throw new Error("task not found");

      // 1. Plan (LLM produces SKUs only — never prices)
      let plan: ShoppingPlan;
      if (task.plan_json) {
        plan = ShoppingPlan.parse(JSON.parse(task.plan_json));
      } else {
        this.bus.emit(taskId, "plan_started", { provider: this.llm.name });
        plan = await this.llm.plan(task.prompt);
        this.db.prepare("UPDATE tasks SET plan_json = ? WHERE task_id = ?").run(JSON.stringify(plan), taskId);
        this.bus.emit(taskId, "plan_ready", { plan });
      }

      // 2. Discover nearby merchant agents (free endpoint, Haversine-sorted)
      this.setStatus(taskId, "discovering");
      const discovery = await fetch(
        `${this.cfg.merchantsUrl}/discovery?lat=${task.lat}&lng=${task.lng}&radius=${this.cfg.discoveryRadiusM}`,
      );
      if (!discovery.ok) throw new Error(`discovery failed: ${discovery.status}`);
      const merchants = ((await discovery.json()) as { merchants: unknown[] }).merchants.map((m) =>
        MerchantPublic.parse(m),
      );
      this.db.prepare("UPDATE tasks SET discovery_json = ? WHERE task_id = ?").run(JSON.stringify(merchants), taskId);
      this.bus.emit(taskId, "discovery_complete", { count: merchants.length, merchants });

      // 3. Gather quotes — every request paid via the x402 handshake
      this.setStatus(taskId, "quoting");
      const candidates = await this.gatherQuotes(taskId, plan.items, merchants);
      if (candidates.length === 0) throw new Error("No merchant could quote any item on the list.");

      // 4. Micro-actions within budget
      this.setStatus(taskId, "researching");
      await this.reserveScarceStock(taskId, plan.items, candidates);
      this.qualityScore(taskId, plan.items, candidates);
      await this.negotiateLeadingOffers(taskId, candidates);

      // 5. Build 2–3 options from the (possibly negotiated) active quotes
      const { options, unfulfillable } = buildOptions(plan.items, candidates);
      if (options.length === 0) throw new Error("Could not build any shopping option from the quotes.");
      if (unfulfillable.length > 0) {
        this.bus.emit(taskId, "items_unfulfillable", { skus: unfulfillable });
      }
      this.db.prepare("UPDATE tasks SET options_json = ? WHERE task_id = ?").run(JSON.stringify(options), taskId);
      this.setStatus(taskId, "options_ready");
      this.bus.emit(taskId, "options_ready", { options, budget: this.payments.budget(taskId) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(taskId, message);
    }
  }

  /** One quote per merchant covering the plan items it can plausibly supply. */
  private async gatherQuotes(
    taskId: string,
    planItems: PlanItem[],
    merchants: MerchantPublic[],
  ): Promise<CandidateQuote[]> {
    const out: CandidateQuote[] = [];
    for (const merchant of merchants) {
      // Category match; markets are general stores and get the whole list.
      const wanted = planItems.filter(
        (i) => getSku(i.sku).category === merchant.category || merchant.category === "market",
      );
      if (wanted.length === 0) continue;

      // Faz J §3 — quote-basket replaces quote: one paid call also returns
      // quality/prepTime/reservation-eligibility, so no separate paid `ask`
      // call is needed later for quality (see qualityScore below).
      const result = await this.paid(taskId, merchant, "quote-basket", {
        items: wanted.map((i) => ({ sku: i.sku, qty: i.qty })),
        taskId,
      });
      if (result.status !== 200) {
        this.bus.emit(taskId, "quote_unavailable", { merchant: merchant.slug, error: result.json?.error });
        continue;
      }
      const quote = SignedQuote.parse(result.json.quote);
      const verified =
        quote.merchantWallet === merchant.wallet &&
        quote.validUntil > nowSec() &&
        (await verifyQuoteSignature(quote));
      this.db
        .prepare(
          "INSERT OR REPLACE INTO quotes_seen (quote_id, task_id, merchant_slug, quote_json, signature_verified, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)",
        )
        .run(quote.quoteId, taskId, merchant.slug, JSON.stringify(quote), verified ? 1 : 0, nowSec());
      this.bus.emit(taskId, "quote_received", {
        merchant: merchant.slug,
        merchantName: merchant.name,
        quoteId: quote.quoteId,
        totalMicroUsdc: quote.totalMicroUsdc,
        items: quote.items,
        validUntil: quote.validUntil,
        nonce: quote.nonce,
        signatureVerified: verified,
        stockHints: result.json.stockHints ?? {},
        omittedSkus: result.json.omittedSkus ?? [],
        prepTimeMin: result.json.prepTimeMin,
      });
      if (!verified) continue; // unverifiable quotes never reach options/escrow
      out.push({ merchant, quote });
      (quote as SignedQuote & { stockHints?: Record<string, number> }).stockHints = result.json.stockHints;
    }
    return out;
  }

  /** Reserve when the merchant supports it and our need nearly drains stock. */
  private async reserveScarceStock(taskId: string, planItems: PlanItem[], candidates: CandidateQuote[]): Promise<void> {
    for (const { merchant, quote } of candidates) {
      if (!merchant.reservation) continue;
      const hints = (quote as SignedQuote & { stockHints?: Record<string, number> }).stockHints ?? {};
      for (const qi of quote.items) {
        const need = planItems.find((p) => p.sku === qi.sku)?.qty ?? 0;
        const stock = hints[qi.sku];
        if (need === 0 || stock === undefined || stock - need > 1) continue;
        const result = await this.paid(taskId, merchant, "reserve", { sku: qi.sku, qty: need, quoteId: quote.quoteId, taskId });
        if (result.status === 200) {
          this.bus.emit(taskId, "reservation_made", {
            merchant: merchant.slug,
            merchantName: merchant.name,
            sku: qi.sku,
            qty: need,
            reservationId: result.json.reservationId,
            expiresAt: result.json.expiresAt,
            ttlSeconds: result.json.ttlSeconds,
            reason: `Son stok (${stock} adet) — TTL ile kilitlendi.`,
          });
        }
      }
    }
  }

  /**
   * Faz J §3 — quality is now a FREE byproduct of quote-basket (already on
   * `candidate.merchant.qualityScore` from discovery, in fact): only when
   * ≥2 specialists of the item's home category compete does the comparison
   * mean anything (butcher vs butcher — cross-category spreads like fresh
   * bakery bread vs packaged market bread aren't a quality signal). No paid
   * `ask` call anymore — the old spread-vs-oracle-cost gate existed only to
   * justify that call's cost, which no longer exists.
   */
  private qualityScore(taskId: string, planItems: PlanItem[], candidates: CandidateQuote[]): void {
    for (const item of planItems) {
      const homeCategory = getSku(item.sku).category;
      const suppliers = candidates.filter(
        (c) => c.merchant.category === homeCategory && c.quote.items.some((qi) => qi.sku === item.sku),
      );
      if (suppliers.length < 2) continue;
      const prices = suppliers.map((s) => s.quote.items.find((qi) => qi.sku === item.sku)!.unitPriceMicroUsdc);
      const spread = Math.max(...prices) - Math.min(...prices);

      const scored = suppliers.map((s) => ({
        merchant: s.merchant.slug,
        merchantName: s.merchant.name,
        qualityScore: s.merchant.qualityScore,
        unitPriceMicroUsdc: s.quote.items.find((qi) => qi.sku === item.sku)!.unitPriceMicroUsdc,
      }));
      this.bus.emit(taskId, "quality_scored", { sku: item.sku, spreadMicroUsdc: spread, oracleCostMicroUsdc: 0, merchants: scored });
    }
  }

  /**
   * Negotiate where it can actually change the basket: with merchants that
   * currently hold the best unit price for at least one SKU they quoted, and
   * only while the budget still covers the planned order fees afterwards.
   *
   * This deliberately isn't "sole supplier of a SKU". A general store quotes
   * the whole list, so in a neighbourhood with one market almost nothing has
   * exactly one supplier — that reading made the agent skip negotiation
   * entirely. Leading on a line is the property that matters: a discount
   * there moves the option totals, while haggling with a merchant that loses
   * every line just spends budget for nothing.
   */
  private async negotiateLeadingOffers(taskId: string, candidates: CandidateQuote[]): Promise<void> {
    // Order creation is free (the acceptance flow creates orders), so there's
    // no later per-shop order fee to reserve budget against.
    const plannedOrderFees = 0;

    for (const candidate of candidates) {
      const { merchant, quote } = candidate;
      if (!merchant.negotiation) continue;
      const leadsOnSomeSku = quote.items.some((qi) => {
        const bestUnitPrice = Math.min(
          ...candidates.flatMap((c) => c.quote.items.filter((o) => o.sku === qi.sku).map((o) => o.unitPriceMicroUsdc)),
        );
        return qi.unitPriceMicroUsdc <= bestUnitPrice; // ties count as leading
      });
      if (!leadsOnSomeSku) continue;

      const fee = ENDPOINT_PRICES_MICRO.negotiate;
      // Optimistic expected discount: half of our 10% request.
      if (Math.floor(quote.totalMicroUsdc * 0.05) <= fee) continue;
      const budget = this.payments.budget(taskId);
      if (budget.remainingMicroUsdc - fee < plannedOrderFees) {
        this.bus.emit(taskId, "negotiation_skipped", {
          merchant: merchant.slug,
          reason: `Budget reserve: ${budget.remainingMicroUsdc} µUSDC remaining, ${plannedOrderFees} µUSDC in planned order fees.`,
        });
        continue;
      }

      const result = await this.paid(taskId, merchant, "negotiate", {
        quoteId: quote.quoteId,
        requestedDiscountBps: 1000,
        taskId,
      });
      if (result.status === 200 && result.json.accepted) {
        const newQuote = SignedQuote.parse(result.json.quote);
        this.db.prepare("UPDATE quotes_seen SET status = 'superseded' WHERE quote_id = ?").run(quote.quoteId);
        this.db
          .prepare(
            "INSERT OR REPLACE INTO quotes_seen (quote_id, task_id, merchant_slug, quote_json, signature_verified, status, created_at) VALUES (?, ?, ?, ?, 1, 'active', ?)",
          )
          .run(newQuote.quoteId, taskId, merchant.slug, JSON.stringify(newQuote), nowSec());
        const hints = (quote as SignedQuote & { stockHints?: Record<string, number> }).stockHints;
        candidate.quote = newQuote;
        (newQuote as SignedQuote & { stockHints?: Record<string, number> }).stockHints = hints;
        this.bus.emit(taskId, "negotiation_success", {
          merchant: merchant.slug,
          merchantName: merchant.name,
          oldQuoteId: quote.quoteId,
          newQuoteId: newQuote.quoteId,
          discountMicroUsdc: result.json.discountMicroUsdc,
          newTotalMicroUsdc: newQuote.totalMicroUsdc,
          feeMicroUsdc: fee,
          feeRefunded: false,
        });
      } else {
        this.bus.emit(taskId, "negotiation_declined", {
          merchant: merchant.slug,
          reason: result.json.reason,
          discountMicroUsdc: result.json.discountMicroUsdc ?? 0,
          feeRefunded: result.feeRefunded,
        });
      }
    }
  }

  /** Every paid merchant call goes through here: 402 handshake + timeline event. */
  private async paid(
    taskId: string,
    merchant: MerchantPublic,
    endpoint: keyof typeof ENDPOINT_PRICES_MICRO,
    body: unknown,
  ) {
    const reason = `${endpoint} @ ${merchant.name}`;
    try {
      const result = await paidFetch(
        this.payments,
        taskId,
        `${this.cfg.merchantsUrl}/merchant/${merchant.slug}/${endpoint}`,
        body,
        { merchantSlug: merchant.slug, reason },
      );
      this.bus.emit(taskId, "paid_request", {
        merchant: merchant.slug,
        merchantName: merchant.name,
        endpoint,
        amountMicroUsdc: result.paidMicroUsdc,
        feeRefunded: result.feeRefunded,
        reason,
        ok: result.status === 200,
        status: result.status,
        budget: this.payments.budget(taskId),
      });
      return result;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        this.bus.emit(taskId, "budget_blocked", { endpoint, merchant: merchant.slug, kind: err.kind, detail: err.message });
        return { status: 0, json: { error: "budget_exceeded" }, paidMicroUsdc: 0, feeRefunded: false, idempotencyKey: "", replayed: false };
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Selection + approval + funding saga
  // -------------------------------------------------------------------------
  selectOption(taskId: string, kind: OptionKind): void {
    const task = this.getTask(taskId);
    if (!task) throw new Error("task not found");
    if (task.status !== "options_ready") throw new Error(`cannot select option in status ${task.status}`);
    const options: ShoppingOption[] = JSON.parse(task.options_json ?? "[]");
    const option = options.find((o) => o.kind === kind);
    if (!option) throw new Error(`option not available: ${kind}`);
    this.db.prepare("UPDATE tasks SET selected_option = ?, status = 'awaiting_approval' WHERE task_id = ?").run(kind, taskId);
    this.bus.emit(taskId, "option_selected", { kind, option });
    this.bus.emit(taskId, "status", { status: "awaiting_approval" });
  }

  async approvePayment(taskId: string): Promise<void> {
    const task = this.getTask(taskId);
    if (!task) throw new Error("task not found");
    if (task.status !== "awaiting_approval") throw new Error(`cannot approve in status ${task.status}`);
    const options: ShoppingOption[] = JSON.parse(task.options_json ?? "[]");
    const option = options.find((o) => o.kind === task.selected_option);
    if (!option) throw new Error("no selected option");

    this.bus.emit(taskId, "approval_received", { kind: option.kind, totalMicroUsdc: option.totalMicroUsdc });

    // Faz I §2 — real merchant acceptance window, only when Postgres is
    // wired. The task now waits for merchant_pending → merchant_confirmed
    // per shop (see resolveMerchantAcceptance/acceptanceTimeoutTick) before
    // any escrow row is even created — escrow is funded from the user's own
    // wallet later (§4), never signed server-side. Mock mode (no Postgres)
    // keeps the pre-Faz-I fast-forward below, unchanged.
    if (this.pg) {
      this.setStatus(taskId, "awaiting_merchant");
      await this.openAcceptanceWindow(taskId, option.shops);
      return;
    }

    this.setStatus(taskId, "funding");

    // Essential shops first (options.ts already sorts this way).
    for (const shop of option.shops) {
      const funded = await this.fundShop(taskId, shop);
      if (funded) continue;

      // Saga step 1: alternative merchant with a usable quote for the same items.
      const alternative = this.findAlternativeShop(taskId, shop);
      if (alternative) {
        this.bus.emit(taskId, "saga_alternative", {
          failedMerchant: shop.merchantSlug,
          alternativeMerchant: alternative.merchantSlug,
          items: shop.items.map((i) => i.sku),
        });
        if (await this.fundShop(taskId, alternative)) continue;
      }

      // Saga step 2: drop the shop if nothing in it is essential.
      if (!shop.essential) {
        this.db
          .prepare("INSERT INTO dropped_shops (task_id, merchant_slug, merchant_name, items_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(taskId, shop.merchantSlug, shop.merchantName, JSON.stringify(shop.items), "escrow funding failed — non-essential shop dropped", nowSec());
        this.bus.emit(taskId, "shop_dropped", {
          merchant: shop.merchantSlug,
          merchantName: shop.merchantName,
          items: shop.items,
          reason: "Escrow funding failed; no alternative merchant was available; optional items were removed.",
        });
        continue;
      }

      // Saga step 3: essential and unrecoverable → cancel + refund everything.
      this.bus.emit(taskId, "saga_cancel", {
        merchant: shop.merchantSlug,
        reason: "Essential shop could not be funded and no alternative exists.",
      });
      await this.cancelTask(taskId, `Essential shop ${shop.merchantSlug} could not be funded.`);
      return;
    }

    // Orders may already have advanced past paid_in_escrow (merchants
    // auto-prepare) — anything not cancelled/refunded counts as funded.
    const fundedOrders = this.db
      .prepare("SELECT COUNT(*) AS c FROM task_orders WHERE task_id = ? AND state NOT IN ('cancelled', 'refunded')")
      .get(taskId) as { c: number };
    if (fundedOrders.c === 0) {
      this.fail(taskId, "No shop could be funded.");
      return;
    }
    this.setStatus(taskId, "in_progress");
    this.bus.emit(taskId, "funding_complete", {
      fundedShops: fundedOrders.c,
      budget: this.payments.budget(taskId),
      walletBalanceMicroUsdc: await this.chain.walletBalanceMicroUsdc(),
    });
    this.maybeFinalize(taskId);
  }

  // -------------------------------------------------------------------------
  // Faz I §2 — merchant acceptance flow (Postgres path only). Escrow rows
  // are created only once every shop reaches merchant_confirmed; funding
  // itself (§4) happens from the user's own connected wallet, never here.
  // -------------------------------------------------------------------------

  /** Opens a merchant_pending window for each shop and records the pending Postgres rows. */
  private async openAcceptanceWindow(taskId: string, shops: OptionShop[]): Promise<void> {
    const pg = this.pg!;
    const acceptanceIds: string[] = [];
    for (const shop of shops) {
      const merchantOrgId = await getMerchantOrgIdBySlug(pg.db, shop.merchantSlug);
      if (!merchantOrgId) {
        // Merchant has no Postgres org (shouldn't happen once seed-pg.ts has
        // run) — treat like an immediate rejection so the saga still resolves.
        this.bus.emit(taskId, "funding_failed", { merchant: shop.merchantSlug, error: "merchant_not_provisioned_in_postgres" });
        continue;
      }
      await this.mirrorQuoteToPostgres(taskId, merchantOrgId, shop.quoteId);
      const orderId = `o_${randomUUID()}`;
      await createTaskOrderPending(pg.db, {
        id: orderId,
        taskId,
        merchantId: merchantOrgId,
        quoteId: shop.quoteId,
        itemsJson: shop.items,
        totalMicroUsdc: shop.subtotalMicroUsdc,
        essential: shop.essential,
      });
      const expiresAt = new Date(Date.now() + MERCHANT_ACCEPT_WINDOW_SEC * 1000);
      const acceptance = await createAcceptance(pg.db, { taskId, merchantId: merchantOrgId, expiresAt });
      acceptanceIds.push(acceptance.id);
      this.bus.emit(taskId, "merchant_pending", {
        merchant: shop.merchantSlug,
        merchantName: shop.merchantName,
        orderId,
        totalMicroUsdc: shop.subtotalMicroUsdc,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      });
    }
    // Create every pending row first, then accept sequentially. The last
    // callback can safely observe that no merchant_pending order remains and
    // open the funding step exactly once.
    if (this.cfg.autoAcceptMerchantOrders) {
      for (const acceptanceId of acceptanceIds) await this.requestMerchantAutoAccept(acceptanceId);
    }
  }

  private async requestMerchantAutoAccept(acceptanceId: string): Promise<void> {
    const response = await fetch(`${this.cfg.merchantsUrl}/console/acceptances/${acceptanceId}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => undefined);
    if (!response?.ok) {
      console.error(`[bridge] merchant agent auto-accept failed for ${acceptanceId}: ${response?.status ?? "offline"}`);
    }
  }

  /** Re-drives pending rows after a service restart so existing tasks cannot remain stuck. */
  async autoAcceptPendingMerchantOrders(): Promise<number> {
    if (!this.cfg.autoAcceptMerchantOrders || !this.pg) return 0;
    const response = await fetch(`${this.cfg.merchantsUrl}/console/acceptances`).catch(() => undefined);
    if (!response?.ok) return 0;
    const body = (await response.json()) as { acceptances?: { acceptanceId: string; expiresAt: number }[] };
    const pending = (body.acceptances ?? []).filter((row) => row.expiresAt > nowSec());
    for (const row of pending) await this.requestMerchantAutoAccept(row.acceptanceId);
    return pending.length;
  }

  /** Called by the bridge's /internal/acceptance-resolved endpoint once merchant-agents accepts/rejects. */
  async resolveMerchantAcceptance(params: {
    taskId: string;
    merchantSlug: string;
    orderId: string;
    decision: "accepted" | "rejected";
    reason?: string;
  }): Promise<void> {
    const pg = this.pg;
    if (!pg) return;
    const { taskId, merchantSlug, orderId, decision, reason } = params;
    if (decision === "rejected") {
      await updateTaskOrderState(pg.db, orderId, "merchant_rejected", { note: reason });
      this.bus.emit(taskId, "merchant_rejected", { merchant: merchantSlug, orderId, reason });
      await this.handlePgRejection(taskId, orderId, merchantSlug);
      return;
    }
    await updateTaskOrderState(pg.db, orderId, "merchant_confirmed");
    this.bus.emit(taskId, "merchant_confirmed", { merchant: merchantSlug, orderId });
    await this.maybeOpenFunding(taskId);
  }

  /** Timeout worker tick — expires stale merchant_pending windows and runs the same saga as an explicit rejection. */
  async acceptanceTimeoutTick(): Promise<number> {
    const pg = this.pg;
    if (!pg) return 0;
    const expired = await expireStaleAcceptances(pg.db);
    for (const row of expired) {
      const order = await getTaskOrderByTaskAndMerchant(pg.db, row.taskId, row.merchantId);
      if (!order || order.state !== "merchant_pending") continue;
      const merchantSlug = (await getMerchantOrgSlugById(pg.db, row.merchantId)) ?? "unknown";
      await updateTaskOrderState(pg.db, order.id, "expired", { note: "merchant acceptance window expired" });
      this.bus.emit(row.taskId, "merchant_rejected", { merchant: merchantSlug, orderId: order.id, reason: "acceptance_window_expired" });
      await this.handlePgRejection(row.taskId, order.id, merchantSlug);
    }
    return expired.length;
  }

  /** Alternative-merchant / drop / cancel saga, reusing the same quote pool findAlternativeShop already searches. */
  private async handlePgRejection(taskId: string, failedOrderId: string, failedMerchantSlug: string): Promise<void> {
    const pg = this.pg!;
    const failedOrder = await getTaskOrder(pg.db, failedOrderId);
    if (!failedOrder) return;
    const failedShop: OptionShop = {
      merchantId: 0,
      merchantSlug: failedMerchantSlug,
      merchantName: failedMerchantSlug,
      quoteId: failedOrder.quoteId ?? "",
      items: failedOrder.itemsJson as QuoteItem[],
      subtotalMicroUsdc: Number(failedOrder.totalMicroUsdc),
      distanceM: 0,
      essential: failedOrder.essential,
    };

    const alternative = this.findAlternativeShop(taskId, failedShop);
    if (alternative) {
      this.bus.emit(taskId, "saga_alternative", {
        failedMerchant: failedMerchantSlug,
        alternativeMerchant: alternative.merchantSlug,
        items: failedShop.items.map((i) => i.sku),
      });
      await this.openAcceptanceWindow(taskId, [alternative]);
      return;
    }

    if (!failedShop.essential) {
      this.db
        .prepare("INSERT INTO dropped_shops (task_id, merchant_slug, merchant_name, items_json, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(taskId, failedMerchantSlug, failedMerchantSlug, JSON.stringify(failedShop.items), "merchant rejected/expired — non-essential shop dropped", nowSec());
      this.bus.emit(taskId, "shop_dropped", {
        merchant: failedMerchantSlug,
        merchantName: failedMerchantSlug,
        items: failedShop.items,
        reason: "Merchant rejected or timed out; no alternative was available; optional items were removed.",
      });
      await this.maybeOpenFunding(taskId);
      return;
    }

    this.bus.emit(taskId, "saga_cancel", { merchant: failedMerchantSlug, reason: "Essential shop could not be confirmed and no alternative exists." });
    await this.cancelPgTask(taskId, `Essential shop ${failedMerchantSlug} could not be confirmed.`);
  }

  /** Once no merchant_pending orders remain, generates pickup codes + escrow rows for every merchant_confirmed shop. */
  private async maybeOpenFunding(taskId: string): Promise<void> {
    const pg = this.pg!;
    const orders = await listTaskOrdersForTask(pg.db, taskId);
    if (orders.some((o) => o.state === "merchant_pending")) return; // still waiting on someone

    const confirmed = orders.filter((o) => o.state === "merchant_confirmed");
    if (confirmed.length === 0) {
      this.fail(taskId, "No shop could be confirmed.");
      return;
    }

    // Faz I §4 — the buyer of record is the user's OWN connected wallet
    // (Faz C's account/session), never the bridge's own session wallet.
    // No wallet on file (shouldn't happen post-Faz-C SIWE login) fails loud
    // rather than silently funding to the wrong address.
    const accountId = await getPgTaskOwner(pg.db, taskId);
    const account = accountId ? await getAccountView(pg.db, accountId) : null;
    if (!account) {
      this.fail(taskId, "No connected wallet on file for this account — cannot open the funding step.");
      return;
    }
    const buyer = account.walletAddress;
    for (const order of confirmed) {
      const pickupCode = String(randomInt(100000, 1000000));
      const pickupCodeHash = keccak256HexUtf8(pickupCode);
      const releaseDeadline = new Date(Date.now() + (this.cfg.releaseDeadlineSecs ?? 3600) * 1000);
      await updateTaskOrderState(pg.db, order.id, "awaiting_funding", { pickupCodeHash });
      await createEscrowRow(pg.db, {
        taskOrderId: order.id,
        // Solana has no numeric chain id (cluster name + RPC URL is the
        // whole identity) — 0 is a placeholder; packages/db's schema should
        // drop this column outright in a later pass. See paymentClient.ts.
        chainId: 0,
        buyerAddress: buyer,
        merchantId: order.merchantId,
        amountMicroUsdc: Number(order.totalMicroUsdc),
        quoteHash: await this.quoteHashFor(order.quoteId ?? undefined),
        pickupCodeHash,
        releaseDeadline,
      });
      this.bus.emit(taskId, "funding_ready", {
        orderId: order.id,
        merchantId: order.merchantId,
        amountMicroUsdc: Number(order.totalMicroUsdc),
        pickupCode,
        releaseDeadline: Math.floor(releaseDeadline.getTime() / 1000),
      });
    }
    this.setStatus(taskId, "awaiting_funding");
  }

  // -------------------------------------------------------------------------
  // Faz I §4 — funding wizard: the browser signs approve()+fund() with the
  // user's own wallet and reports the tx hash here. The bridge never signs a
  // fund tx itself in the Postgres path — it only reads the resulting
  // on-chain state back (chain.getEscrow) and cross-checks it against the
  // escrow row it created in maybeOpenFunding, exactly like every other
  // value on this row (amount/quoteHash/pickupCodeHash) was already fixed
  // before the wizard ever ran.
  // -------------------------------------------------------------------------
  async verifyFunding(taskId: string, orderId: string, escrowOrderId: number, txSignature: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const pg = this.pg;
    if (!pg) return { ok: false, error: "postgres_not_configured" };
    const order = await getTaskOrder(pg.db, orderId);
    if (!order || order.taskId !== taskId) return { ok: false, error: "order_not_found" };
    if (order.state !== "awaiting_funding") return { ok: false, error: `order not awaiting funding (state=${order.state})` };
    const escrowRow = await getEscrowByTaskOrder(pg.db, orderId);
    if (!escrowRow) return { ok: false, error: "escrow_row_not_found" };

    const onChain = await this.chain.getEscrow(escrowOrderId);
    if (!onChain) return { ok: false, error: "escrow not found on-chain for that escrowOrderId" };
    if (onChain.buyer !== escrowRow.buyerAddress) return { ok: false, error: "buyer_mismatch" };
    if (onChain.amountMicroUsdc !== Number(escrowRow.amountMicroUsdc)) return { ok: false, error: "amount_mismatch" };
    if (onChain.quoteHash !== escrowRow.quoteHash) return { ok: false, error: "quote_hash_mismatch" };
    if (onChain.pickupCodeHash !== escrowRow.pickupCodeHash) return { ok: false, error: "pickup_code_hash_mismatch" };
    if (onChain.state !== "Funded") return { ok: false, error: `unexpected on-chain state: ${onChain.state}` };

    await updateEscrowState(pg.db, orderId, "Funded", { escrowOrderId, fundTxHash: txSignature });
    await updateTaskOrderState(pg.db, orderId, "paid_in_escrow");
    this.bus.emit(taskId, "escrow_funded", {
      orderId,
      merchantId: order.merchantId,
      escrowOrderId,
      txRef: txSignature,
      amountMicroUsdc: Number(order.totalMicroUsdc),
    });

    const merchantSlug = await getMerchantOrgSlugById(pg.db, order.merchantId);
    if (merchantSlug) {
      const response = await fetch(`${this.cfg.merchantsUrl}/internal/order-funded`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId, escrowOrderId, txSignature, merchantSlug }),
        }).catch((err) => {
          console.error(`[bridge] order-funded webhook failed for ${orderId}:`, err);
          return undefined;
        });
      if (response && !response.ok) {
        console.error(`[bridge] order-funded webhook returned ${response.status} for ${orderId}: ${await response.text()}`);
      }
    }

    const orders = await listTaskOrdersForTask(pg.db, taskId);
    if (orders.every((o) => o.state === "paid_in_escrow" || o.state === "cancelled")) {
      this.setStatus(taskId, "in_progress");
    }
    return { ok: true };
  }

  /** Verifies the buyer-signed on-chain release before completing a live order. */
  async verifyUserRelease(taskId: string, orderId: string, escrowOrderId: number, txSignature: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const pg = this.pg;
    if (!pg) return { ok: false, error: "postgres_not_configured" };
    const order = await getTaskOrder(pg.db, orderId);
    if (!order || order.taskId !== taskId) return { ok: false, error: "order_not_found" };
    if (!["paid_in_escrow", "preparing", "ready"].includes(order.state)) {
      return { ok: false, error: `order cannot be released (state=${order.state})` };
    }
    const escrowRow = await getEscrowByTaskOrder(pg.db, orderId);
    if (!escrowRow || escrowRow.escrowOrderId === null) return { ok: false, error: "funded_escrow_not_found" };
    if (Number(escrowRow.escrowOrderId) !== escrowOrderId) return { ok: false, error: "escrow_order_id_mismatch" };

    const onChain = await this.chain.getEscrow(escrowOrderId);
    if (!onChain) return { ok: false, error: "escrow_not_found_on_chain" };
    if (onChain.buyer !== escrowRow.buyerAddress) return { ok: false, error: "buyer_mismatch" };
    if (onChain.amountMicroUsdc !== Number(escrowRow.amountMicroUsdc)) return { ok: false, error: "amount_mismatch" };
    if (onChain.state !== "Released") return { ok: false, error: `unexpected on-chain state: ${onChain.state}` };

    await updateEscrowState(pg.db, orderId, "Released", { releaseTxHash: txSignature });
    await updateTaskOrderState(pg.db, orderId, "completed", { note: "buyer confirmed received items" });
    await this.handlePgOrderEvent({
      taskId,
      orderId,
      state: "completed",
      txRef: txSignature,
      note: "Buyer released merchant payment.",
    });
    await fetch(`${this.cfg.merchantsUrl}/internal/escrow-released`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, txRef: txSignature }),
    }).catch(() => {});
    return { ok: true };
  }

  /**
   * `task_orders.quote_id` FKs to Postgres `quotes_seen`, which bridge never
   * wrote to before Faz I (quotes live in bridge's own SQLite — see
   * quoteHashFor below). Mirror the specific quote a shop was built from
   * before referencing it, so the FK holds; onConflictDoNothing makes this
   * safe to call again for the same quote (e.g. an alternative-merchant
   * saga retry).
   */
  private async mirrorQuoteToPostgres(taskId: string, merchantOrgId: string, quoteId: string): Promise<void> {
    const pg = this.pg!;
    const row = this.db.prepare("SELECT quote_json, signature_verified FROM quotes_seen WHERE quote_id = ?").get(quoteId) as
      | { quote_json: string; signature_verified: number }
      | undefined;
    if (!row) return;
    await pg.db
      .insert(quotesSeen)
      .values({
        quoteId,
        taskId,
        merchantId: merchantOrgId,
        quoteJson: JSON.parse(row.quote_json),
        signatureVerified: !!row.signature_verified,
      })
      .onConflictDoNothing();
  }

  /** Recomputes the quote hash from bridge's local quotes_seen record (still SQLite — quotes aren't part of the Faz I Postgres migration). */
  private async quoteHashFor(quoteId?: string): Promise<string> {
    if (!quoteId) return "0".repeat(64);
    const row = this.db.prepare("SELECT quote_json FROM quotes_seen WHERE quote_id = ?").get(quoteId) as { quote_json: string } | undefined;
    if (!row) return "0".repeat(64);
    const quote = SignedQuote.parse(JSON.parse(row.quote_json));
    return bytesToHex(await hashQuote(quote));
  }

  /** Cancel fallback for the Postgres acceptance path — releases any stock already committed by confirmed shops. */
  private async cancelPgTask(taskId: string, reason: string): Promise<void> {
    const pg = this.pg!;
    const orders = await listTaskOrdersForTask(pg.db, taskId);
    for (const order of orders) {
      if (order.state === "merchant_confirmed" || order.state === "awaiting_funding") {
        await restockAfterCancel(pg.db, order.merchantId, order.itemsJson as QuoteItem[]);
        await updateTaskOrderState(pg.db, order.id, "cancelled", { note: reason });
      } else if (order.state === "merchant_pending") {
        await updateTaskOrderState(pg.db, order.id, "cancelled", { note: reason });
      }
    }
    this.db.prepare("UPDATE tasks SET status = 'cancelled', error = ? WHERE task_id = ?").run(reason, taskId);
    this.bus.emit(taskId, "task_cancelled", { reason });
  }

  /** Paid order request + escrow funding for one shop. Returns false on failure. */
  private async fundShop(taskId: string, shop: OptionShop): Promise<boolean> {
    const merchants: MerchantPublic[] = JSON.parse(this.getTask(taskId)!.discovery_json ?? "[]");
    const merchant = merchants.find((m) => m.slug === shop.merchantSlug);
    if (!merchant) return false;

    const quoteRow = this.db
      .prepare("SELECT quote_json, signature_verified FROM quotes_seen WHERE quote_id = ?")
      .get(shop.quoteId) as { quote_json: string; signature_verified: number } | undefined;
    if (!quoteRow) return false;
    const quote = SignedQuote.parse(JSON.parse(quoteRow.quote_json));

    // Verify the signature against the merchant's registered wallet one last
    // time before any money moves — non-negotiable rule #4.
    if (!quoteRow.signature_verified || !(await verifyQuoteSignature(quote)) || quote.validUntil <= nowSec()) {
      this.bus.emit(taskId, "funding_failed", { merchant: shop.merchantSlug, error: "quote verification failed or expired" });
      return false;
    }

    const pickupCode = String(randomInt(100000, 1000000));
    const pickupCodeHash = keccak256HexUtf8(pickupCode);
    const buyer = this.chain.walletAddress();

    // Faz J §3 — /order is free now (no this.paid() 402 handshake needed).
    const orderRes = await fetch(`${this.cfg.merchantsUrl}/merchant/${merchant.slug}/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteId: shop.quoteId,
        taskId,
        buyer,
        pickupCodeHash,
        items: shop.items.map((i) => ({ sku: i.sku, qty: i.qty })),
      }),
    });
    const orderJson = (await orderRes.json()) as any;
    if (orderRes.status !== 200) {
      this.bus.emit(taskId, "funding_failed", { merchant: shop.merchantSlug, error: orderJson?.error ?? "order rejected" });
      return false;
    }
    const { orderId, totalMicroUsdc, releaseDeadline } = orderJson;

    try {
      const { escrowOrderId, txRef } = await this.chain.fund({
        merchantId: merchant.merchantId,
        merchantSlug: merchant.slug,
        buyer,
        amountMicroUsdc: totalMicroUsdc,
        quoteHash: bytesToHex(await hashQuote(quote)),
        pickupCodeHash,
        releaseDeadline,
      });
      this.db
        .prepare(
          `INSERT INTO task_orders (order_id, task_id, merchant_id, merchant_slug, merchant_name, quote_id, items_json,
            total_micro, state, essential, pickup_code, escrow_order_id, escrow_tx, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid_in_escrow', ?, ?, ?, ?, ?)`,
        )
        .run(
          orderId, taskId, merchant.merchantId, merchant.slug, merchant.name, shop.quoteId,
          JSON.stringify(shop.items), totalMicroUsdc, shop.essential ? 1 : 0, pickupCode,
          escrowOrderId, txRef, nowSec(),
        );
      await fetch(`${this.cfg.merchantsUrl}/internal/escrow-funded`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, escrowOrderId, txRef }),
      });
      this.bus.emit(taskId, "escrow_funded", {
        merchant: merchant.slug,
        merchantName: merchant.name,
        orderId,
        escrowOrderId,
        txRef,
        amountMicroUsdc: totalMicroUsdc,
        pickupCode,
        releaseDeadline,
      });
      return true;
    } catch (err) {
      // Funding reverted → release the merchant-side order + its stock.
      await fetch(`${this.cfg.merchantsUrl}/internal/cancel-order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      }).catch(() => {});
      this.bus.emit(taskId, "funding_failed", {
        merchant: merchant.slug,
        merchantName: merchant.name,
        orderId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  /** A different merchant whose active verified quote covers the same items. */
  private findAlternativeShop(taskId: string, failed: OptionShop): OptionShop | undefined {
    const rows = this.db
      .prepare("SELECT quote_id, merchant_slug, quote_json FROM quotes_seen WHERE task_id = ? AND status = 'active' AND signature_verified = 1")
      .all(taskId) as unknown as { quote_id: string; merchant_slug: string; quote_json: string }[];
    const merchants: MerchantPublic[] = JSON.parse(this.getTask(taskId)!.discovery_json ?? "[]");
    for (const row of rows) {
      if (row.merchant_slug === failed.merchantSlug) continue;
      const quote = SignedQuote.parse(JSON.parse(row.quote_json));
      if (quote.validUntil <= nowSec()) continue;
      const covers = failed.items.every((need) => quote.items.some((qi) => qi.sku === need.sku && qi.qty >= need.qty));
      if (!covers) continue;
      const merchant = merchants.find((m) => m.slug === row.merchant_slug);
      if (!merchant) continue;
      const items = failed.items.map((need) => ({
        sku: need.sku,
        qty: need.qty,
        unitPriceMicroUsdc: quote.items.find((qi) => qi.sku === need.sku)!.unitPriceMicroUsdc,
      }));
      return {
        merchantId: merchant.merchantId,
        merchantSlug: merchant.slug,
        merchantName: merchant.name,
        quoteId: quote.quoteId,
        items,
        subtotalMicroUsdc: items.reduce((s, i) => s + i.unitPriceMicroUsdc * i.qty, 0),
        distanceM: merchant.distanceM ?? 0,
        essential: failed.essential,
      };
    }
    return undefined;
  }

  /** Cancel + refund fallback: refunds every escrow that is still refundable. */
  async cancelTask(taskId: string, reason: string): Promise<void> {
    const orders = this.db
      .prepare("SELECT * FROM task_orders WHERE task_id = ? AND state IN ('paid_in_escrow', 'preparing', 'ready')")
      .all(taskId) as any[];
    for (const order of orders) {
      try {
        const { txRef } = await this.chain.refund(order.escrow_order_id, reason);
        this.db
          .prepare("UPDATE task_orders SET state = 'refunded', release_tx = ?, note = ? WHERE order_id = ?")
          .run(txRef, `cancelled: ${reason}`, order.order_id);
        this.bus.emit(taskId, "escrow_refunded", { merchant: order.merchant_slug, orderId: order.order_id, txRef, reason });
      } catch (err) {
        this.bus.emit(taskId, "refund_failed", {
          merchant: order.merchant_slug,
          orderId: order.order_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    this.db.prepare("UPDATE tasks SET status = 'cancelled', error = ? WHERE task_id = ?").run(reason, taskId);
    this.bus.emit(taskId, "task_cancelled", { reason });
  }

  // -------------------------------------------------------------------------
  // Settlement watching + receipt
  // -------------------------------------------------------------------------
  async handleOrderEvent(payload: {
    taskId: string;
    orderId: string;
    state: string;
    txRef?: string;
    note?: string;
  }): Promise<void> {
    const order = this.db.prepare("SELECT * FROM task_orders WHERE order_id = ?").get(payload.orderId) as any;
    if (!order) {
      await this.handlePgOrderEvent(payload);
      return;
    }
    const updates: string[] = ["state = ?"];
    const args: unknown[] = [payload.state];
    if (payload.txRef && (payload.state === "completed" || payload.state === "refunded")) {
      updates.push("release_tx = ?");
      args.push(payload.txRef);
    }
    if (payload.note) {
      updates.push("note = ?");
      args.push(payload.note);
    }
    args.push(payload.orderId);
    this.db.prepare(`UPDATE task_orders SET ${updates.join(", ")} WHERE order_id = ?`).run(...(args as any[]));
    this.bus.emit(payload.taskId, "order_update", {
      orderId: payload.orderId,
      merchant: order.merchant_slug,
      merchantName: order.merchant_name,
      state: payload.state,
      txRef: payload.txRef,
      note: payload.note,
    });
    this.maybeFinalize(payload.taskId);
  }

  private maybeFinalize(taskId: string): void {
    const task = this.getTask(taskId);
    if (!task || task.status !== "in_progress") return;
    const open = this.db
      .prepare("SELECT COUNT(*) AS c FROM task_orders WHERE task_id = ? AND state NOT IN ('completed', 'refunded', 'cancelled')")
      .get(taskId) as { c: number };
    if (open.c > 0) return;
    void this.finalize(taskId);
  }

  /**
   * Faz I §5 — mirrors handleOrderEvent/maybeFinalize for a Postgres-tracked
   * task_order: merchant-agents already wrote the new state directly (shared
   * DB), so this only needs to read it back for the SSE payload and check
   * completion. NOTE: full receipt generation (`finalize()`) still reads
   * exclusively from bridge's own SQLite task_orders and does not yet know
   * about Postgres-tracked shops — building a Postgres-aware receipt is
   * follow-up work (adjacent to Faz K's paid-timeline transcript), not
   * attempted here. Every order still reaches `completed` correctly; only
   * the final consolidated receipt document is the known gap.
   */
  private async handlePgOrderEvent(payload: { taskId: string; orderId: string; state: string; txRef?: string; note?: string }): Promise<void> {
    const pg = this.pg;
    if (!pg) return;
    const order = await getTaskOrder(pg.db, payload.orderId);
    if (!order) return;
    const merchantSlug = await getMerchantOrgSlugById(pg.db, order.merchantId);
    this.bus.emit(payload.taskId, "order_update", {
      orderId: payload.orderId,
      merchant: merchantSlug,
      state: payload.state,
      txRef: payload.txRef,
      note: payload.note,
    });
    const orders = await listTaskOrdersForTask(pg.db, payload.taskId);
    if (orders.every((o) => o.state === "completed" || o.state === "refunded" || o.state === "cancelled")) {
      this.bus.emit(payload.taskId, "task_orders_settled", {
        note: "All orders have settled. The consolidated receipt is ready.",
      });
    }
  }

  private async finalize(taskId: string): Promise<void> {
    const task = this.getTask(taskId)!;
    const plan: ShoppingPlan = JSON.parse(task.plan_json!);
    const orders = this.db.prepare("SELECT * FROM task_orders WHERE task_id = ?").all(taskId) as any[];
    const dropped = this.db.prepare("SELECT * FROM dropped_shops WHERE task_id = ?").all(taskId) as any[];

    const completedOrders = orders.filter((o) => o.state === "completed");
    const completedSkus = new Set<string>();
    for (const o of completedOrders) for (const item of JSON.parse(o.items_json)) completedSkus.add(item.sku);

    const shops: ReceiptShop[] = [
      ...completedOrders.map((o) => ({
        merchantSlug: o.merchant_slug,
        merchantName: o.merchant_name,
        status: "completed" as const,
        amountMicroUsdc: o.total_micro,
        items: JSON.parse(o.items_json),
        pickupCode: o.pickup_code,
        escrowTx: o.escrow_tx,
        releaseTx: o.release_tx,
      })),
      ...orders
        .filter((o) => o.state === "refunded")
        .map((o) => ({
          merchantSlug: o.merchant_slug,
          merchantName: o.merchant_name,
          status: "refunded" as const,
          amountMicroUsdc: o.total_micro,
          items: JSON.parse(o.items_json),
          escrowTx: o.escrow_tx,
          releaseTx: o.release_tx,
          note: o.note ?? "refunded",
        })),
      ...dropped.map((d) => ({
        merchantSlug: d.merchant_slug,
        merchantName: d.merchant_name,
        status: "dropped" as const,
        amountMicroUsdc: 0,
        items: JSON.parse(d.items_json),
        note: d.reason,
      })),
    ];

    const totalResearch = (this.db
      .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS s FROM spend WHERE task_id = ? AND status = 'settled'")
      .get(taskId) as { s: number }).s;
    const totalMain = completedOrders.reduce((s, o) => s + o.total_micro, 0);

    const receiptBase: Omit<Receipt, "receiptId" | "receiptTx"> = {
      taskRef: taskId,
      totalResearchMicroUsdc: totalResearch,
      totalMainMicroUsdc: totalMain,
      completedItems: completedSkus.size,
      totalItems: plan.items.length,
      completedShops: completedOrders.length,
      totalShops: orders.length + dropped.length,
      shops,
      metadataURI: `local://receipts/${taskId}.json`,
      metadataHash: keccak256HexUtf8(JSON.stringify({ taskRef: taskId, shops, totalResearch, totalMain })),
      createdAt: nowSec(),
    };
    const { receiptId, txRef } = await this.chain.createReceipt({
      taskRef: taskId,
      totalResearchMicroUsdc: totalResearch,
      totalMainMicroUsdc: totalMain,
      completedItems: receiptBase.completedItems,
      totalItems: receiptBase.totalItems,
      metadataURI: receiptBase.metadataURI,
      metadataHash: receiptBase.metadataHash,
    });
    const receipt: Receipt = { ...receiptBase, receiptId: `receipt_${receiptId}`, receiptTx: txRef };
    this.db.prepare("UPDATE tasks SET receipt_json = ?, status = 'settled' WHERE task_id = ?").run(JSON.stringify(receipt), taskId);
    this.bus.emit(taskId, "receipt_ready", { receipt });
    this.bus.emit(taskId, "status", { status: "settled" });
  }

  // -------------------------------------------------------------------------
  // Manual fallbacks + feedback
  // -------------------------------------------------------------------------
  async userRelease(taskId: string, orderId: string): Promise<{ txRef: string }> {
    const order = this.db.prepare("SELECT * FROM task_orders WHERE order_id = ? AND task_id = ?").get(orderId, taskId) as any;
    if (!order) throw new Error("order not found");
    const { txRef } = await this.chain.userRelease(order.escrow_order_id);
    this.db
      .prepare("UPDATE task_orders SET state = 'completed', release_tx = ?, note = 'manual user release (fallback)' WHERE order_id = ?")
      .run(txRef, orderId);
    this.bus.emit(taskId, "order_update", {
      orderId,
      merchant: order.merchant_slug,
      state: "completed",
      txRef,
      note: "manual user release (fallback)",
    });
    await fetch(`${this.cfg.merchantsUrl}/internal/escrow-released`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId, txRef }),
    }).catch(() => {});
    this.maybeFinalize(taskId);
    return { txRef };
  }

  async submitFeedback(taskId: string, entries: { merchantId: number; score: number; tags: string[] }[]): Promise<{ txRefs: string[] }> {
    const task = this.getTask(taskId);
    if (!task) throw new Error("task not found");
    const merchants: MerchantPublic[] = JSON.parse(task.discovery_json ?? "[]");
    const txRefs: string[] = [];
    for (const entry of entries) {
      const merchant = merchants.find((m) => m.merchantId === entry.merchantId);
      if (!merchant) continue;
      const { txRef } = await this.chain.postFeedback(
        merchant.agentId,
        entry.score,
        entry.tags,
        `local://receipts/${taskId}.json`,
      );
      this.db
        .prepare("INSERT INTO feedback (task_id, merchant_id, score, tags_json, tx_ref, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(taskId, entry.merchantId, entry.score, JSON.stringify(entry.tags), txRef, nowSec());
      txRefs.push(txRef);
      this.bus.emit(taskId, "feedback_posted", { merchant: merchant.slug, score: entry.score, tags: entry.tags, txRef });
    }
    return { txRefs };
  }

  budgetSummary(taskId: string) {
    const spend = this.db
      .prepare("SELECT payment_id, amount_micro, endpoint, merchant_slug, reason, status, created_at FROM spend WHERE task_id = ? ORDER BY created_at")
      .all(taskId) as any[];
    return {
      budget: this.payments.budget(taskId),
      entries: spend.map((s) => ({
        paymentId: s.payment_id,
        amountMicroUsdc: s.amount_micro,
        amountUsdc: microToUsdc(s.amount_micro),
        endpoint: s.endpoint,
        merchant: s.merchant_slug,
        reason: s.reason,
        status: s.status,
      })),
    };
  }
}

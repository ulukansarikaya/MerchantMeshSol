import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import { address as toAddress, createKeyPairSignerFromPrivateKeyBytes, type Address, type KeyPairSigner, type Rpc, type SolanaRpcApi } from "@solana/kit";
import { loadMasterKey, encryptPrivateKey } from "@merchantmesh/shared/sessionWalletCrypto";
import {
  bytesToHex,
  buildInstruction,
  deriveDirectoryStatePda,
  deriveMerchantPda,
  deriveEscrowConfigPda,
  deriveMerchantWalletPda,
  deriveOrderPda,
  deriveVaultPda,
  deriveAssociatedTokenAddress,
  fetchAndDecodeAccount,
  sendAndConfirmInstructions,
  keccak256Utf8,
  MERCHANT_DIRECTORY_IDL,
  ORDER_ESCROW_IDL,
  MERCHANT_DIRECTORY_PROGRAM_ID,
  ORDER_ESCROW_PROGRAM_ID,
} from "@merchantmesh/shared";
import {
  type Db,
  MerchantAccessDeniedError,
  MerchantNotFoundError,
  requireMerchantMember,
  createMerchantOrg,
  listMerchantsForAccount,
  getMerchantOrgById,
  getMerchantPayoutWalletAddress,
  updateMerchantOrg,
  updateMerchantSettings,
  createMerchantProduct,
  updateMerchantProduct,
  deactivateMerchantProduct,
  listMerchantProducts,
  listInventory,
  adjustInventory,
  ensureDefaultWarehouse,
  getMerchantProductBySku,
  listCampaigns,
  createCampaign,
  updateCampaign,
  publishMerchantOrg,
  suspendMerchantOrg,
  activateMerchantOrg,
  listAllMerchantsForOperator,
  listPricingDecisions,
  createDispute,
  getDispute,
  setDisputeStatus,
  listDisputesForOperator,
  listDisputesForMerchant,
  getTaskOrder,
  listTaskOrdersForTask,
  getPgTaskOwner,
  getEscrowByTaskOrder,
  updateEscrowState,
} from "@merchantmesh/db";

export interface MerchantRoutesConfig {
  db: Db;
  rpc: Rpc<SolanaRpcApi>;
  relayer: KeyPairSigner;
  usdcMint: Address;
  operatorAccountIds: Set<string>;
  merchantsUrl: string;
}

type AppEnv = { Variables: { accountId: string; walletAddress: string } };

export class OperatorRequiredError extends Error {
  constructor() {
    super("operator_required");
  }
}

/**
 * Hono only keeps the LAST `app.onError` handler registered, so this file
 * doesn't register its own — app.ts's single onError calls this to also
 * catch the ownership/operator errors these routes throw, alongside its
 * existing ZodError handling.
 */
export function mapMerchantRouteError(err: unknown): { status: 403 | 404; body: { error: string } } | undefined {
  if (err instanceof MerchantAccessDeniedError) return { status: 403, body: { error: "merchant_access_denied" } };
  if (err instanceof MerchantNotFoundError) return { status: 404, body: { error: "merchant_not_found" } };
  if (err instanceof OperatorRequiredError) return { status: 403, body: { error: "operator_required" } };
  return undefined;
}

/**
 * Registers the Faz 2/3 self-service merchant CRUD + a minimal operator
 * surface directly onto the shared app instance (not a mounted sub-app) so
 * `sessionRequired`/context variables from app.ts keep working unmodified.
 */
export function registerMerchantRoutes(app: Hono<AppEnv>, cfg: MerchantRoutesConfig, sessionRequired: MiddlewareHandler<AppEnv>): void {
  const { db } = cfg;

  // -------------------------------------------------------------------------
  // Merchant-agent lifecycle
  // -------------------------------------------------------------------------
  const CreateMerchantBody = z.object({
    slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(200),
    category: z.enum(["butcher", "greengrocer", "bakery", "market"]),
    lat: z.number(),
    lng: z.number(),
  });

  app.post("/merchant-agents", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    const body = CreateMerchantBody.parse(await c.req.json());

    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const encryptedSignerKey = encryptPrivateKey(bytesToHex(seed), loadMasterKey());

    const merchantId = await createMerchantOrg(db, {
      accountId,
      slug: body.slug,
      name: body.name,
      category: body.category,
      lat: body.lat,
      lng: body.lng,
      walletAddress: signer.address,
      encryptedSignerKey,
    });
    return c.json({ ok: true, merchantId, walletAddress: signer.address }, 201);
  });

  app.get("/merchant-agents/mine", sessionRequired, async (c) => {
    const merchants = await listMerchantsForAccount(db, c.get("accountId"));
    return c.json({ merchants: merchants.map((m) => ({ ...m, onChainMerchantId: m.onChainMerchantId?.toString() ?? null })) });
  });

  app.get("/merchant-agents/:id", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    const org = await getMerchantOrgById(db, merchantId);
    return c.json({ merchant: { ...org, onChainMerchantId: org.onChainMerchantId?.toString() ?? null, encryptedSignerKey: undefined } });
  });

  const UpdateMerchantBody = z.object({
    name: z.string().min(1).max(200).optional(),
    endpointUri: z.string().url().optional(),
    serviceRadiusM: z.number().int().positive().optional(),
    agentStrategy: z.enum(["balanced", "aggressive", "conservative"]).optional(),
    negotiationEnabled: z.boolean().optional(),
    maxDiscountBps: z.number().int().min(0).max(2000).optional(),
    offerWhenLowStock: z.boolean().optional(),
    prepTimeMin: z.number().int().positive().optional(),
  });

  app.patch("/merchant-agents/:id", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    const body = UpdateMerchantBody.parse(await c.req.json());
    const { negotiationEnabled, maxDiscountBps, offerWhenLowStock, prepTimeMin, ...orgFields } = body;
    await updateMerchantOrg(db, merchantId, orgFields);
    await updateMerchantSettings(db, merchantId, { negotiationEnabled, maxDiscountBps, offerWhenLowStock, prepTimeMin });
    return c.json({ ok: true });
  });

  /** Operator-only: registers the merchant on-chain (merchant_directory.list_merchant + order_escrow.set_merchant_wallet) and flips status→active. */
  app.post("/merchant-agents/:id/publish", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    if (!cfg.operatorAccountIds.has(accountId)) throw new OperatorRequiredError();
    const merchantId = c.req.param("id");
    const org = await getMerchantOrgById(db, merchantId);
    if (org.onChainMerchantId !== null) return c.json({ error: "already_published", onChainMerchantId: org.onChainMerchantId.toString() }, 409);

    const [directoryState] = await deriveDirectoryStatePda();
    const dirState = await fetchAndDecodeAccount<{ next_merchant_id: bigint }>(cfg.rpc, MERCHANT_DIRECTORY_IDL, "DirectoryState", directoryState);
    if (!dirState) return c.json({ error: "merchant_directory_not_initialized" }, 500);
    const onChainMerchantId = dirState.next_merchant_id;

    const walletAddress = await getMerchantPayoutWalletAddress(db, merchantId);

    const [merchantPda] = await deriveMerchantPda(onChainMerchantId);
    const listIx = buildInstruction(
      MERCHANT_DIRECTORY_IDL,
      MERCHANT_DIRECTORY_PROGRAM_ID,
      "list_merchant",
      { authority: cfg.relayer.address, directory_state: directoryState, merchant: merchantPda },
      {
        merchant_id: onChainMerchantId,
        agent_id: 0,
        name: org.name,
        category: org.category,
        endpoint_uri: org.endpointUri ?? `${cfg.merchantsUrl}/merchant/${org.slug}`,
        wallet: toAddress(walletAddress),
        geo_hash: keccak256Utf8(org.slug),
        attestation_uid: new Uint8Array(32),
      },
    );
    await sendAndConfirmInstructions(cfg.rpc, cfg.relayer, [listIx]);

    const [escrowConfig] = await deriveEscrowConfigPda();
    const [merchantWalletPda] = await deriveMerchantWalletPda(onChainMerchantId);
    const setWalletIx = buildInstruction(
      ORDER_ESCROW_IDL,
      ORDER_ESCROW_PROGRAM_ID,
      "set_merchant_wallet",
      { authority: cfg.relayer.address, escrow_config: escrowConfig, merchant_wallet: merchantWalletPda },
      { merchant_id: onChainMerchantId, wallet: toAddress(walletAddress) },
    );
    await sendAndConfirmInstructions(cfg.rpc, cfg.relayer, [setWalletIx]);

    await publishMerchantOrg(db, merchantId, onChainMerchantId);
    return c.json({ ok: true, onChainMerchantId: onChainMerchantId.toString() });
  });

  app.post("/merchant-agents/:id/suspend", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    if (!cfg.operatorAccountIds.has(accountId)) throw new OperatorRequiredError();
    await suspendMerchantOrg(db, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/merchant-agents/:id/activate", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    if (!cfg.operatorAccountIds.has(accountId)) throw new OperatorRequiredError();
    await activateMerchantOrg(db, c.req.param("id"));
    return c.json({ ok: true });
  });

  app.get("/merchant-agents/:id/decisions", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    const decisions = await listPricingDecisions(db, merchantId);
    return c.json({
      decisions: decisions.map((d) => ({
        ...d,
        baseTotalMicroUsdc: d.baseTotalMicroUsdc.toString(),
        discountMicroUsdc: d.discountMicroUsdc.toString(),
        finalTotalMicroUsdc: d.finalTotalMicroUsdc.toString(),
      })),
    });
  });

  /** Read-only — a merchant can see disputes raised against their own orders, but only an operator can act on them (see /admin/disputes below). */
  app.get("/merchant-agents/:id/disputes", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    const rows = await listDisputesForMerchant(db, merchantId);
    return c.json({ disputes: rows.map((r) => ({ ...r.dispute, taskId: r.taskOrder.taskId })) });
  });

  // -------------------------------------------------------------------------
  // Products
  // -------------------------------------------------------------------------
  const CreateProductBody = z.object({
    canonicalSku: z.string().min(1),
    merchantProductName: z.string().min(1).max(200),
    description: z.string().optional(),
    unitType: z.string().min(1),
    unitSize: z.string().optional(),
    basePriceMicroUsdc: z.coerce.bigint().positive(),
    minimumPriceMicroUsdc: z.coerce.bigint().positive(),
    costMicroUsdc: z.coerce.bigint().optional(),
    minMarginMicroUsdc: z.coerce.bigint().optional(),
    maxDiscountBps: z.number().int().min(0).max(2000).optional(),
    initialStock: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(0).optional(),
  });

  app.post("/merchant-agents/:id/products", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager", "inventory_manager"]);
    const body = CreateProductBody.parse(await c.req.json());
    if (body.basePriceMicroUsdc < body.minimumPriceMicroUsdc) return c.json({ error: "base_below_minimum" }, 400);
    const warehouseId = await ensureDefaultWarehouse(db, merchantId);
    const merchantProductId = await createMerchantProduct(db, { merchantId, warehouseId, ...body });
    return c.json({ ok: true, merchantProductId }, 201);
  });

  app.get("/merchant-agents/:id/products", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    const products = await listMerchantProducts(db, merchantId);
    return c.json({
      products: products.map((p) => ({
        ...p,
        basePriceMicroUsdc: p.basePriceMicroUsdc.toString(),
        minimumPriceMicroUsdc: p.minimumPriceMicroUsdc.toString(),
        costMicroUsdc: p.costMicroUsdc?.toString() ?? null,
        minMarginMicroUsdc: p.minMarginMicroUsdc?.toString() ?? null,
      })),
    });
  });

  const UpdateProductBody = z.object({
    merchantProductName: z.string().min(1).max(200).optional(),
    description: z.string().optional(),
    basePriceMicroUsdc: z.coerce.bigint().positive().optional(),
    minimumPriceMicroUsdc: z.coerce.bigint().positive().optional(),
    costMicroUsdc: z.coerce.bigint().optional(),
    minMarginMicroUsdc: z.coerce.bigint().optional(),
    maxDiscountBps: z.number().int().min(0).max(2000).optional(),
    lowStockBehavior: z.enum(["block", "discount_off", "hold"]).optional(),
    active: z.boolean().optional(),
  });

  app.patch("/merchant-agents/:id/products/:productId", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager", "inventory_manager"]);
    const body = UpdateProductBody.parse(await c.req.json());
    await updateMerchantProduct(db, merchantId, c.req.param("productId"), body);
    return c.json({ ok: true });
  });

  app.delete("/merchant-agents/:id/products/:productId", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    await deactivateMerchantProduct(db, merchantId, c.req.param("productId"));
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Inventory
  // -------------------------------------------------------------------------
  app.get("/merchant-agents/:id/inventory", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    return c.json({ inventory: await listInventory(db, merchantId) });
  });

  const AdjustInventoryBody = z.object({
    merchantProductId: z.string().uuid(),
    delta: z.number().int(),
    movementType: z.enum(["stock_in", "manual_adjustment", "waste"]),
    note: z.string().optional(),
  });

  app.post("/merchant-agents/:id/inventory/adjust", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    const accountId = c.get("accountId");
    await requireMerchantMember(db, accountId, merchantId, ["owner", "manager", "inventory_manager"]);
    const body = AdjustInventoryBody.parse(await c.req.json());
    await adjustInventory(db, { ...body, merchantId, actorAccountId: accountId });
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Pricing policies
  // -------------------------------------------------------------------------
  app.get("/merchant-agents/:id/pricing-policies", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    const org = await getMerchantOrgById(db, merchantId);
    const products = await listMerchantProducts(db, merchantId);
    return c.json({
      merchantWide: { pricingPolicyVersion: org.pricingPolicyVersion },
      perSku: products.map((p) => ({
        sku: p.canonicalSku,
        basePriceMicroUsdc: p.basePriceMicroUsdc.toString(),
        minimumPriceMicroUsdc: p.minimumPriceMicroUsdc.toString(),
        minMarginMicroUsdc: p.minMarginMicroUsdc?.toString() ?? null,
        maxDiscountBps: p.maxDiscountBps,
        lowStockBehavior: p.lowStockBehavior,
      })),
    });
  });

  const PricingPolicyBody = z.object({
    minMarginMicroUsdc: z.coerce.bigint().optional(),
    maxDiscountBps: z.number().int().min(0).max(2000).optional(),
    lowStockBehavior: z.enum(["block", "discount_off", "hold"]).optional(),
  });

  app.put("/merchant-agents/:id/pricing-policies/:sku", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    const product = await getMerchantProductBySku(db, merchantId, c.req.param("sku"));
    if (!product) return c.json({ error: "product_not_found" }, 404);
    const body = PricingPolicyBody.parse(await c.req.json());
    await updateMerchantProduct(db, merchantId, product.id, body);
    return c.json({ ok: true });
  });

  app.patch("/merchant-agents/:id/strategy", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    const body = z.object({ agentStrategy: z.enum(["balanced", "aggressive", "conservative"]) }).parse(await c.req.json());
    await updateMerchantOrg(db, merchantId, body);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Campaigns (basic CRUD)
  // -------------------------------------------------------------------------
  app.get("/merchant-agents/:id/campaigns", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId);
    return c.json({ campaigns: await listCampaigns(db, merchantId) });
  });

  const CreateCampaignBody = z.object({
    name: z.string().min(1).max(200),
    description: z.string().optional(),
    startAt: z.coerce.date().optional(),
    endAt: z.coerce.date().optional(),
    stackPolicy: z.enum(["exclusive", "stackable"]).optional(),
    rule: z.object({
      ruleType: z.enum(["percent_off", "fixed_off", "bogo", "bundle", "min_basket", "time_window", "loyalty", "first_order"]),
      ruleJson: z.unknown().optional(),
      discountType: z.enum(["percent", "fixed"]),
      discountValue: z.coerce.bigint(),
      maximumDiscountMicroUsdc: z.coerce.bigint().optional(),
    }),
  });

  app.post("/merchant-agents/:id/campaigns", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    const body = CreateCampaignBody.parse(await c.req.json());
    const campaignId = await createCampaign(db, { merchantId, ...body });
    return c.json({ ok: true, campaignId }, 201);
  });

  app.patch("/merchant-agents/:id/campaigns/:campaignId", sessionRequired, async (c) => {
    const merchantId = c.req.param("id");
    await requireMerchantMember(db, c.get("accountId"), merchantId, ["owner", "manager"]);
    const body = z.object({ status: z.enum(["draft", "active", "paused", "expired"]).optional(), name: z.string().optional(), description: z.string().optional() }).parse(await c.req.json());
    await updateCampaign(db, merchantId, c.req.param("campaignId"), body);
    return c.json({ ok: true });
  });

  // -------------------------------------------------------------------------
  // Operator admin surface
  // -------------------------------------------------------------------------
  app.get("/admin/merchants", sessionRequired, async (c) => {
    if (!cfg.operatorAccountIds.has(c.get("accountId"))) throw new OperatorRequiredError();
    const merchants = await listAllMerchantsForOperator(db);
    return c.json({
      merchants: merchants.map((m) => ({ ...m, onChainMerchantId: m.onChainMerchantId?.toString() ?? null, encryptedSignerKey: undefined })),
    });
  });

  // -------------------------------------------------------------------------
  // Disputes — customer-facing open, operator-facing review/resolve/close
  // -------------------------------------------------------------------------

  /**
   * A task's data only ever belongs to the account that created it — a task
   * owned by someone else 404s rather than 403s, matching the bridge's
   * "don't reveal existence" rule for /tasks* (see README's Faz C section).
   */
  async function requireTaskOwner(taskId: string, accountId: string): Promise<boolean> {
    return (await getPgTaskOwner(db, taskId)) === accountId;
  }

  /** Lets the web app discover real (Postgres) order ids for a task, since the receipt page's data otherwise comes entirely from the bridge's mock-mode SQLite and never carries one. */
  app.get("/shopping/tasks/:taskId/orders", sessionRequired, async (c) => {
    const taskId = c.req.param("taskId");
    if (!(await requireTaskOwner(taskId, c.get("accountId")))) return c.json({ error: "task_not_found" }, 404);
    const orders = await listTaskOrdersForTask(db, taskId);
    return c.json({
      orders: orders.map((o) => ({ ...o, totalMicroUsdc: o.totalMicroUsdc.toString() })),
    });
  });

  const OpenDisputeBody = z.object({ reason: z.string().min(1).max(2000) });

  app.post("/shopping/tasks/:taskId/orders/:orderId/dispute", sessionRequired, async (c) => {
    const taskId = c.req.param("taskId");
    if (!(await requireTaskOwner(taskId, c.get("accountId")))) return c.json({ error: "task_not_found" }, 404);
    const order = await getTaskOrder(db, c.req.param("orderId"));
    if (!order || order.taskId !== taskId) return c.json({ error: "order_not_found" }, 404);
    const body = OpenDisputeBody.parse(await c.req.json());
    const disputeId = await createDispute(db, {
      taskOrderId: order.id,
      merchantId: order.merchantId,
      raisedByAccountId: c.get("accountId"),
      reason: body.reason,
    });
    return c.json({ ok: true, disputeId }, 201);
  });

  app.get("/admin/disputes", sessionRequired, async (c) => {
    if (!cfg.operatorAccountIds.has(c.get("accountId"))) throw new OperatorRequiredError();
    return c.json({ disputes: await listDisputesForOperator(db) });
  });

  app.post("/admin/disputes/:disputeId/review", sessionRequired, async (c) => {
    if (!cfg.operatorAccountIds.has(c.get("accountId"))) throw new OperatorRequiredError();
    await setDisputeStatus(db, c.req.param("disputeId"), "reviewing");
    return c.json({ ok: true });
  });

  const ResolveDisputeBody = z.object({ outcome: z.enum(["refund", "release"]), resolution: z.string().optional() });

  app.post("/admin/disputes/:disputeId/resolve", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    if (!cfg.operatorAccountIds.has(accountId)) throw new OperatorRequiredError();
    const body = ResolveDisputeBody.parse(await c.req.json());
    const dispute = await getDispute(db, c.req.param("disputeId"));

    // Calls the already-deployed order_escrow.resolve instruction (arbiter-gated —
    // the relayer key is already escrow_config's arbiter, set at Faz 1 devnet init).
    // This is the first real caller of `resolve`, which has sat deployed-but-unused
    // since Faz 1.
    const escrow = await getEscrowByTaskOrder(db, dispute.taskOrderId);
    if (!escrow || escrow.escrowOrderId === null) {
      return c.json({ error: "escrow_not_funded", detail: "Nothing on-chain to resolve for this order." }, 400);
    }
    const merchantOrg = await getMerchantOrgById(db, dispute.merchantId);
    if (merchantOrg.onChainMerchantId === null) {
      return c.json({ error: "merchant_not_published", detail: "Merchant has no on-chain identity." }, 400);
    }

    const onChainOrderId = escrow.escrowOrderId;
    const [escrowConfig] = await deriveEscrowConfigPda();
    const [order] = await deriveOrderPda(onChainOrderId);
    const [vault] = await deriveVaultPda(onChainOrderId);
    const [merchantWalletPda] = await deriveMerchantWalletPda(merchantOrg.onChainMerchantId);
    const merchantWalletAccount = await fetchAndDecodeAccount<{ wallet: Address }>(cfg.rpc, ORDER_ESCROW_IDL, "MerchantWallet", merchantWalletPda);
    if (!merchantWalletAccount) return c.json({ error: "merchant_wallet_not_registered_on_chain" }, 500);

    const buyerAddress = toAddress(escrow.buyerAddress);
    const buyerTokenAccount = await deriveAssociatedTokenAddress(buyerAddress, cfg.usdcMint);
    const merchantTokenAccount = await deriveAssociatedTokenAddress(merchantWalletAccount.wallet, cfg.usdcMint);

    const resolveIx = buildInstruction(
      ORDER_ESCROW_IDL,
      ORDER_ESCROW_PROGRAM_ID,
      "resolve",
      {
        arbiter: cfg.relayer.address,
        escrow_config: escrowConfig,
        order,
        vault,
        buyer_token_account: buyerTokenAccount,
        merchant_wallet: merchantWalletPda,
        merchant_token_account: merchantTokenAccount,
        buyer: buyerAddress,
      },
      { order_id: onChainOrderId, release_to_merchant: body.outcome === "release" },
    );
    const txSignature = await sendAndConfirmInstructions(cfg.rpc, cfg.relayer, [resolveIx]);

    await updateEscrowState(db, dispute.taskOrderId, body.outcome === "refund" ? "Refunded" : "Released", { releaseTxHash: txSignature });
    await setDisputeStatus(db, c.req.param("disputeId"), body.outcome === "refund" ? "refunded" : "released", {
      resolvedByAccountId: accountId,
      resolution: body.resolution,
    });
    return c.json({ ok: true, txSignature });
  });

  app.post("/admin/disputes/:disputeId/close", sessionRequired, async (c) => {
    if (!cfg.operatorAccountIds.has(c.get("accountId"))) throw new OperatorRequiredError();
    await setDisputeStatus(db, c.req.param("disputeId"), "closed");
    return c.json({ ok: true });
  });
}

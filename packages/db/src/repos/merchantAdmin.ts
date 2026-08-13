import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  merchantOrganizations,
  merchantMembers,
  merchantWallets,
  merchantSettings,
  merchantLocations,
  merchantHours,
  merchantProducts,
  warehouses,
  inventory,
  inventoryMovements,
  campaigns,
  campaignRules,
  pricingDecisions,
} from "../schema/index.js";
import { ewktPoint } from "../types.js";

/**
 * Faz 2 — self-service merchant CRUD + ownership. Separate from repos/merchant.ts
 * (the read-oriented catalog/reservation layer merchant-agents' quote path uses)
 * so that file stays focused and this one owns every write path a merchant
 * owner/operator can trigger through platform-api.
 */

export class MerchantAccessDeniedError extends Error {
  constructor(public merchantId: string) {
    super(`merchant_access_denied: ${merchantId}`);
  }
}

export class MerchantNotFoundError extends Error {
  constructor(public merchantId: string) {
    super(`merchant_not_found: ${merchantId}`);
  }
}

export type MerchantRole = "owner" | "manager" | "inventory_manager" | "order_operator" | "finance_viewer";

/** Ownership guard every merchant-scoped platform-api route calls first. Throws, never returns falsy. */
export async function requireMerchantMember(
  db: Db,
  accountId: string,
  merchantId: string,
  allowedRoles?: MerchantRole[],
): Promise<{ role: MerchantRole }> {
  const [member] = await db
    .select({ role: merchantMembers.role })
    .from(merchantMembers)
    .where(and(eq(merchantMembers.merchantId, merchantId), eq(merchantMembers.accountId, accountId)))
    .limit(1);
  if (!member) throw new MerchantAccessDeniedError(merchantId);
  const role = member.role as MerchantRole;
  if (allowedRoles && !allowedRoles.includes(role)) throw new MerchantAccessDeniedError(merchantId);
  return { role };
}

export interface CreateMerchantOrgParams {
  accountId: string;
  slug: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  /** Public address of the signer generated for this merchant — see packages/shared/sessionWalletCrypto.ts for the encrypt-at-rest scheme; encryption happens at the call site (platform-api), not here. */
  walletAddress: string;
  encryptedSignerKey: string;
}

/** Creates the org (status=draft) + default settings + location + payout wallet + owner membership, atomically. */
export async function createMerchantOrg(db: Db, params: CreateMerchantOrgParams): Promise<string> {
  return db.transaction(async (tx) => {
    const [org] = await tx
      .insert(merchantOrganizations)
      .values({
        slug: params.slug,
        name: params.name,
        category: params.category,
        status: "draft",
        active: false,
        encryptedSignerKey: params.encryptedSignerKey,
      })
      .returning();
    const merchantId = org!.id;

    await tx.insert(merchantSettings).values({ merchantId });
    await tx.insert(merchantLocations).values({ merchantId, location: ewktPoint(params.lat, params.lng) });
    await tx.insert(merchantWallets).values({ merchantId, address: params.walletAddress, isPayout: true });
    await tx.insert(merchantMembers).values({ merchantId, accountId: params.accountId, role: "owner" });

    return merchantId;
  });
}

export interface MerchantSummary {
  id: string;
  slug: string;
  name: string;
  category: string;
  status: string;
  runtime: string;
  active: boolean;
  onChainMerchantId: bigint | null;
  role: MerchantRole;
}

export async function listMerchantsForAccount(db: Db, accountId: string): Promise<MerchantSummary[]> {
  const rows = await db
    .select({
      id: merchantOrganizations.id,
      slug: merchantOrganizations.slug,
      name: merchantOrganizations.name,
      category: merchantOrganizations.category,
      status: merchantOrganizations.status,
      runtime: merchantOrganizations.runtime,
      active: merchantOrganizations.active,
      onChainMerchantId: merchantOrganizations.onChainMerchantId,
      role: merchantMembers.role,
    })
    .from(merchantMembers)
    .innerJoin(merchantOrganizations, eq(merchantOrganizations.id, merchantMembers.merchantId))
    .where(eq(merchantMembers.accountId, accountId));
  return rows.map((r) => ({ ...r, role: r.role as MerchantRole }));
}

export async function getMerchantOrgById(db: Db, merchantId: string) {
  const [org] = await db.select().from(merchantOrganizations).where(eq(merchantOrganizations.id, merchantId)).limit(1);
  if (!org) throw new MerchantNotFoundError(merchantId);
  return org;
}

/** The payout wallet address stored at createMerchantOrg time — see MerchantRoutesConfig's publish handler. */
export async function getMerchantPayoutWalletAddress(db: Db, merchantId: string): Promise<string> {
  const [row] = await db
    .select({ address: merchantWallets.address })
    .from(merchantWallets)
    .where(and(eq(merchantWallets.merchantId, merchantId), eq(merchantWallets.isPayout, true)))
    .limit(1);
  if (!row) throw new Error(`merchant_wallet_not_found: ${merchantId}`);
  return row.address;
}

export interface UpdateMerchantOrgParams {
  name?: string;
  category?: string;
  runtime?: "hosted" | "external";
  endpointUri?: string;
  serviceRadiusM?: number;
  agentStrategy?: "balanced" | "aggressive" | "conservative";
}

export async function updateMerchantOrg(db: Db, merchantId: string, params: UpdateMerchantOrgParams): Promise<void> {
  if (Object.keys(params).length === 0) return;
  await db.update(merchantOrganizations).set(params).where(eq(merchantOrganizations.id, merchantId));
}

export interface UpdateMerchantSettingsParams {
  negotiationEnabled?: boolean;
  maxDiscountBps?: number;
  autoReserve?: boolean;
  reservationTtlSec?: number;
  offerWhenLowStock?: boolean;
  prepTimeMin?: number;
}

export async function updateMerchantSettings(db: Db, merchantId: string, params: UpdateMerchantSettingsParams): Promise<void> {
  if (Object.keys(params).length === 0) return;
  await db.update(merchantSettings).set({ ...params, updatedAt: new Date() }).where(eq(merchantSettings.merchantId, merchantId));
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
export interface CreateMerchantProductParams {
  merchantId: string;
  canonicalSku: string;
  merchantProductName: string;
  description?: string;
  unitType: string;
  unitSize?: string;
  basePriceMicroUsdc: bigint;
  minimumPriceMicroUsdc: bigint;
  costMicroUsdc?: bigint;
  minMarginMicroUsdc?: bigint;
  maxDiscountBps?: number;
  lowStockBehavior?: "block" | "discount_off" | "hold";
  warehouseId: string;
  initialStock: number;
  lowStockThreshold?: number;
}

export async function createMerchantProduct(db: Db, params: CreateMerchantProductParams): Promise<string> {
  return db.transaction(async (tx) => {
    const [product] = await tx
      .insert(merchantProducts)
      .values({
        merchantId: params.merchantId,
        canonicalSku: params.canonicalSku,
        merchantProductName: params.merchantProductName,
        description: params.description,
        unitType: params.unitType,
        unitSize: params.unitSize,
        basePriceMicroUsdc: params.basePriceMicroUsdc,
        minimumPriceMicroUsdc: params.minimumPriceMicroUsdc,
        costMicroUsdc: params.costMicroUsdc,
        minMarginMicroUsdc: params.minMarginMicroUsdc,
        maxDiscountBps: params.maxDiscountBps,
        lowStockBehavior: params.lowStockBehavior ?? "hold",
      })
      .returning();
    const merchantProductId = product!.id;

    await tx.insert(inventory).values({
      warehouseId: params.warehouseId,
      merchantProductId,
      physicalQuantity: params.initialStock,
      reservedQuantity: 0,
      availableQuantity: params.initialStock,
      lowStockThreshold: params.lowStockThreshold ?? 2,
    });

    return merchantProductId;
  });
}

/** Ensures the merchant has a default warehouse, creating one if needed — self-service merchants start with none. */
export async function ensureDefaultWarehouse(db: Db, merchantId: string): Promise<string> {
  const [existing] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.merchantId, merchantId)).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(warehouses).values({ merchantId, name: "Main Warehouse" }).returning();
  return created!.id;
}

export interface UpdateMerchantProductParams {
  merchantProductName?: string;
  description?: string;
  basePriceMicroUsdc?: bigint;
  minimumPriceMicroUsdc?: bigint;
  costMicroUsdc?: bigint;
  minMarginMicroUsdc?: bigint;
  maxDiscountBps?: number;
  lowStockBehavior?: "block" | "discount_off" | "hold";
  active?: boolean;
}

/**
 * Every nested-resource write in this file is scoped by `merchantId` as well as
 * the resource's own id. The route layer already checks the caller is a member
 * of the merchant in the URL, but that alone does not prove the *resource* id
 * belongs to that merchant — without the extra predicate, any member of any
 * merchant (and self-service merchant creation is open to every signed-in
 * account) could pass a victim merchant's productId and have the write land.
 * Scoping here rather than only at the call site keeps future callers safe too.
 */
export async function updateMerchantProduct(
  db: Db,
  merchantId: string,
  merchantProductId: string,
  params: UpdateMerchantProductParams,
): Promise<void> {
  if (Object.keys(params).length === 0) return;
  await db
    .update(merchantProducts)
    .set({ ...params, version: sql`${merchantProducts.version} + 1`, updatedAt: new Date() })
    .where(and(eq(merchantProducts.id, merchantProductId), eq(merchantProducts.merchantId, merchantId)));
}

export async function deactivateMerchantProduct(db: Db, merchantId: string, merchantProductId: string): Promise<void> {
  await db
    .update(merchantProducts)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(merchantProducts.id, merchantProductId), eq(merchantProducts.merchantId, merchantId)));
}

export async function getMerchantProductBySku(db: Db, merchantId: string, canonicalSku: string) {
  const [row] = await db
    .select()
    .from(merchantProducts)
    .where(and(eq(merchantProducts.merchantId, merchantId), eq(merchantProducts.canonicalSku, canonicalSku)))
    .limit(1);
  return row;
}

export async function listMerchantProducts(db: Db, merchantId: string) {
  return db.select().from(merchantProducts).where(eq(merchantProducts.merchantId, merchantId));
}

export interface InventoryLine {
  merchantProductId: string;
  sku: string;
  name: string;
  physicalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  lowStockThreshold: number;
}

export async function listInventory(db: Db, merchantId: string): Promise<InventoryLine[]> {
  const rows = await db
    .select({
      merchantProductId: merchantProducts.id,
      sku: merchantProducts.canonicalSku,
      name: merchantProducts.merchantProductName,
      physicalQuantity: inventory.physicalQuantity,
      reservedQuantity: inventory.reservedQuantity,
      availableQuantity: inventory.availableQuantity,
      lowStockThreshold: inventory.lowStockThreshold,
    })
    .from(merchantProducts)
    .innerJoin(inventory, eq(inventory.merchantProductId, merchantProducts.id))
    .where(eq(merchantProducts.merchantId, merchantId));
  return rows;
}

/** Manual stock adjustment (restock, correction, waste) — atomic update + audit trail row, mirrors repos/merchant.ts's pattern. */
export async function adjustInventory(
  db: Db,
  params: {
    merchantId: string;
    merchantProductId: string;
    delta: number;
    movementType: "stock_in" | "manual_adjustment" | "waste";
    actorAccountId: string;
    note?: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    // Atomic in-place arithmetic (not read-then-write) — same race-free pattern as
    // repos/merchant.ts's reserveInventoryAtomic/commitStockForOrder. The
    // available >= 0 CHECK constraint rejects a delta that would go negative.
    // The merchant_products subquery scopes the write to the caller's own
    // merchant — see the note above updateMerchantProduct.
    const updated = await tx.execute(sql`
      UPDATE inventory
      SET physical_quantity = physical_quantity + ${params.delta},
          available_quantity = available_quantity + ${params.delta},
          version = version + 1,
          updated_at = now()
      WHERE merchant_product_id = ${params.merchantProductId}
        AND merchant_product_id IN (
          SELECT id FROM merchant_products WHERE merchant_id = ${params.merchantId}
        )
      RETURNING id
    `);
    const invRow = (updated.rows as { id: string }[])[0];
    if (!invRow) throw new Error(`inventory_row_not_found_or_would_go_negative: ${params.merchantProductId}`);
    await tx.insert(inventoryMovements).values({
      inventoryId: invRow.id,
      movementType: params.movementType,
      quantityDelta: params.delta,
      sourceType: "manual",
      note: params.note,
      actorAccountId: params.actorAccountId,
    });
  });
}

// ---------------------------------------------------------------------------
// Campaigns — basic CRUD, not a rule-builder
// ---------------------------------------------------------------------------
export async function listCampaigns(db: Db, merchantId: string) {
  const rows = await db.select().from(campaigns).where(eq(campaigns.merchantId, merchantId)).orderBy(desc(campaigns.createdAt));
  const ids = rows.map((r) => r.id);
  const rules = ids.length ? await db.select().from(campaignRules).where(inArray(campaignRules.campaignId, ids)) : [];
  return rows.map((c) => ({ ...c, rules: rules.filter((r) => r.campaignId === c.id) }));
}

export interface CreateCampaignParams {
  merchantId: string;
  name: string;
  description?: string;
  startAt?: Date;
  endAt?: Date;
  stackPolicy?: "exclusive" | "stackable";
  rule: {
    ruleType: string;
    ruleJson?: unknown;
    discountType: "percent" | "fixed";
    discountValue: bigint;
    maximumDiscountMicroUsdc?: bigint;
  };
}

export async function createCampaign(db: Db, params: CreateCampaignParams): Promise<string> {
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(campaigns)
      .values({
        merchantId: params.merchantId,
        name: params.name,
        description: params.description,
        startAt: params.startAt,
        endAt: params.endAt,
        stackPolicy: params.stackPolicy ?? "exclusive",
      })
      .returning();
    await tx.insert(campaignRules).values({
      campaignId: c!.id,
      ruleType: params.rule.ruleType,
      ruleJson: params.rule.ruleJson ?? {},
      discountType: params.rule.discountType,
      discountValue: params.rule.discountValue,
      maximumDiscountMicroUsdc: params.rule.maximumDiscountMicroUsdc,
    });
    return c!.id;
  });
}

export async function updateCampaign(
  db: Db,
  merchantId: string,
  campaignId: string,
  params: { status?: string; name?: string; description?: string },
): Promise<void> {
  if (Object.keys(params).length === 0) return;
  await db
    .update(campaigns)
    .set({ ...params, updatedAt: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.merchantId, merchantId)));
}

/** Campaigns actually eligible to apply right now — status=active, within [startAt, endAt] (either bound may be open-ended), highest priority first. Used by apps/merchant-agents' campaignPricing.ts, never by the customer-facing quote path directly. */
export async function listActiveCampaignsForMerchant(db: Db, merchantId: string, now: Date) {
  const rows = await db
    .select()
    .from(campaigns)
    .where(
      and(
        eq(campaigns.merchantId, merchantId),
        eq(campaigns.status, "active"),
        or(isNull(campaigns.startAt), lte(campaigns.startAt, now)),
        or(isNull(campaigns.endAt), gte(campaigns.endAt, now)),
      ),
    )
    .orderBy(desc(campaigns.priority));
  const ids = rows.map((r) => r.id);
  const rules = ids.length ? await db.select().from(campaignRules).where(inArray(campaignRules.campaignId, ids)) : [];
  return rows.map((c) => ({ ...c, rules: rules.filter((r) => r.campaignId === c.id) }));
}

// ---------------------------------------------------------------------------
// Publish (operator-gated on-chain registration happens at the call site —
// this just flips state + stamps the id the caller already obtained on-chain)
// ---------------------------------------------------------------------------
export async function publishMerchantOrg(db: Db, merchantId: string, onChainMerchantId: bigint): Promise<void> {
  await db
    .update(merchantOrganizations)
    .set({ status: "active", active: true, onChainMerchantId })
    .where(eq(merchantOrganizations.id, merchantId));
}

export async function suspendMerchantOrg(db: Db, merchantId: string): Promise<void> {
  await db.update(merchantOrganizations).set({ status: "suspended", active: false }).where(eq(merchantOrganizations.id, merchantId));
}

export async function activateMerchantOrg(db: Db, merchantId: string): Promise<void> {
  await db.update(merchantOrganizations).set({ status: "active", active: true }).where(eq(merchantOrganizations.id, merchantId));
}

export async function listAllMerchantsForOperator(db: Db) {
  return db.select().from(merchantOrganizations).orderBy(desc(merchantOrganizations.createdAt));
}

// ---------------------------------------------------------------------------
// Pricing decisions (Faz 3 log)
// ---------------------------------------------------------------------------
export interface InsertPricingDecisionParams {
  merchantId: string;
  quoteId?: string;
  inputHash: string;
  model: string;
  promptVersion: string;
  policyVersion: string;
  llmOutputJson?: unknown;
  appliedRulesJson: unknown[];
  baseTotalMicroUsdc: bigint;
  discountMicroUsdc: bigint;
  finalTotalMicroUsdc: bigint;
  validUntil?: number;
  merchantSignature?: string;
  fallbackUsed: boolean;
  fallbackReason?: string;
}

export async function insertPricingDecision(db: Db, params: InsertPricingDecisionParams): Promise<void> {
  await db.insert(pricingDecisions).values(params);
}

export async function listPricingDecisions(db: Db, merchantId: string, limit = 50) {
  return db
    .select()
    .from(pricingDecisions)
    .where(eq(pricingDecisions.merchantId, merchantId))
    .orderBy(desc(pricingDecisions.createdAt))
    .limit(limit);
}

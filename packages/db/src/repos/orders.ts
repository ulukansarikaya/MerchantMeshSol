import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { merchantAcceptances, taskOrders, escrows, merchantOrganizations } from "../schema/index.js";

/**
 * Faz I §2 scaffolding — merchant acceptance window + the Postgres-tracked
 * per-shop order/escrow rows the acceptance flow and funding wizard read
 * and write. Not yet wired into the bridge orchestrator or merchant-agents
 * console (that's §2/§4); these are the repo-level building blocks.
 */
export interface CreateTaskOrderParams {
  id: string; // matches merchant-agents' o_<uuid> convention
  taskId: string;
  merchantId: string; // merchantOrganizations.id (uuid)
  quoteId?: string;
  itemsJson: unknown;
  totalMicroUsdc: number;
  essential: boolean;
}

export async function createTaskOrderPending(db: Db, params: CreateTaskOrderParams): Promise<void> {
  await db.insert(taskOrders).values({
    id: params.id,
    taskId: params.taskId,
    merchantId: params.merchantId,
    quoteId: params.quoteId,
    itemsJson: params.itemsJson,
    totalMicroUsdc: BigInt(params.totalMicroUsdc),
    state: "merchant_pending",
    essential: params.essential,
    stateLogJson: [{ state: "merchant_pending", ts: Math.floor(Date.now() / 1000) }],
  });
}

export async function getTaskOrder(db: Db, id: string) {
  const [row] = await db.select().from(taskOrders).where(eq(taskOrders.id, id)).limit(1);
  return row;
}

export async function listTaskOrdersForTask(db: Db, taskId: string) {
  return db.select().from(taskOrders).where(eq(taskOrders.taskId, taskId));
}

/** At most one task_order per (task, merchant) — each shop in an option maps to one merchant. */
export async function getTaskOrderByTaskAndMerchant(db: Db, taskId: string, merchantId: string) {
  const [row] = await db
    .select()
    .from(taskOrders)
    .where(
      and(
        eq(taskOrders.taskId, taskId),
        eq(taskOrders.merchantId, merchantId),
        eq(taskOrders.state, "merchant_pending"),
      ),
    )
    .orderBy(desc(taskOrders.createdAt))
    .limit(1);
  return row;
}

export async function updateTaskOrderState(
  db: Db,
  id: string,
  state: string,
  extra: { pickupCodeHash?: string; note?: string; escrowId?: string } = {},
): Promise<void> {
  const current = await getTaskOrder(db, id);
  if (!current) throw new Error(`task_order not found: ${id}`);
  const log = [...(current.stateLogJson as { state: string; ts: number }[]), { state, ts: Math.floor(Date.now() / 1000) }];
  await db
    .update(taskOrders)
    .set({ state, stateLogJson: log, ...extra })
    .where(eq(taskOrders.id, id));
}

export interface CreateAcceptanceParams {
  taskId: string;
  merchantId: string;
  expiresAt: Date;
}

export async function createAcceptance(db: Db, params: CreateAcceptanceParams) {
  const [row] = await db
    .insert(merchantAcceptances)
    .values({ taskId: params.taskId, merchantId: params.merchantId, status: "pending", expiresAt: params.expiresAt })
    .returning();
  return row!;
}

export async function getAcceptance(db: Db, id: string) {
  const [row] = await db.select().from(merchantAcceptances).where(eq(merchantAcceptances.id, id)).limit(1);
  return row;
}

export async function listPendingAcceptancesForMerchant(db: Db, merchantId: string) {
  return db
    .select()
    .from(merchantAcceptances)
    .where(and(eq(merchantAcceptances.merchantId, merchantId), eq(merchantAcceptances.status, "pending")));
}

/** Console listing across every merchant this service manages — joins the order + org for display. */
export async function listPendingAcceptancesWithContext(db: Db) {
  return db
    .selectDistinctOn([merchantAcceptances.taskId, merchantAcceptances.merchantId], {
      id: merchantAcceptances.id,
      taskId: merchantAcceptances.taskId,
      merchantId: merchantAcceptances.merchantId,
      merchantSlug: merchantOrganizations.slug,
      merchantName: merchantOrganizations.name,
      expiresAt: merchantAcceptances.expiresAt,
      createdAt: merchantAcceptances.createdAt,
      orderId: taskOrders.id,
      itemsJson: taskOrders.itemsJson,
      totalMicroUsdc: taskOrders.totalMicroUsdc,
    })
    .from(merchantAcceptances)
    .innerJoin(merchantOrganizations, eq(merchantOrganizations.id, merchantAcceptances.merchantId))
    .innerJoin(
      taskOrders,
      and(eq(taskOrders.taskId, merchantAcceptances.taskId), eq(taskOrders.merchantId, merchantAcceptances.merchantId)),
    )
    .where(and(eq(merchantAcceptances.status, "pending"), eq(taskOrders.state, "merchant_pending")))
    .orderBy(
      merchantAcceptances.taskId,
      merchantAcceptances.merchantId,
      desc(merchantAcceptances.createdAt),
      desc(taskOrders.createdAt),
    );
}

export async function resolveAcceptance(db: Db, id: string, status: "accepted" | "rejected", reason?: string): Promise<void> {
  await db
    .update(merchantAcceptances)
    .set({ status, reason, respondedAt: new Date() })
    .where(and(eq(merchantAcceptances.id, id), eq(merchantAcceptances.status, "pending")));
}

/** Timeout worker: pending acceptances whose window passed → expired. Returns the expired rows (bridge needs taskId+merchantId to run the saga). */
export async function expireStaleAcceptances(db: Db) {
  return db
    .update(merchantAcceptances)
    .set({ status: "expired", respondedAt: new Date() })
    .where(and(eq(merchantAcceptances.status, "pending"), lte(merchantAcceptances.expiresAt, sql`now()`)))
    .returning();
}

export interface CreateEscrowParams {
  taskOrderId: string;
  chainId: number;
  buyerAddress: string;
  merchantId: string;
  amountMicroUsdc: number;
  quoteHash: string;
  pickupCodeHash: string;
  releaseDeadline: Date;
}

export async function createEscrowRow(db: Db, params: CreateEscrowParams) {
  const [row] = await db
    .insert(escrows)
    .values({
      taskOrderId: params.taskOrderId,
      chainId: params.chainId,
      buyerAddress: params.buyerAddress,
      merchantId: params.merchantId,
      amountMicroUsdc: BigInt(params.amountMicroUsdc),
      quoteHash: params.quoteHash,
      pickupCodeHash: params.pickupCodeHash,
      releaseDeadline: params.releaseDeadline,
      state: "awaiting_funding",
    })
    .returning();
  return row!;
}

export async function getEscrowByTaskOrder(db: Db, taskOrderId: string) {
  const [row] = await db.select().from(escrows).where(eq(escrows.taskOrderId, taskOrderId)).limit(1);
  return row;
}

export async function updateEscrowState(
  db: Db,
  taskOrderId: string,
  state: string,
  extra: { escrowOrderId?: number; fundTxHash?: string; releaseTxHash?: string } = {},
): Promise<void> {
  await db
    .update(escrows)
    .set({
      state,
      ...(extra.escrowOrderId !== undefined ? { escrowOrderId: BigInt(extra.escrowOrderId) } : {}),
      ...(extra.fundTxHash !== undefined ? { fundTxHash: extra.fundTxHash } : {}),
      ...(extra.releaseTxHash !== undefined ? { releaseTxHash: extra.releaseTxHash } : {}),
    })
    .where(eq(escrows.taskOrderId, taskOrderId));
}

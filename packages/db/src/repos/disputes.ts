import { desc, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { disputes, taskOrders } from "../schema/index.js";

/**
 * Minimal manual dispute log (no stake/slashing) — see AGENTS.md's live-mode
 * rules. Resolving to refunded/released is expected to also call the
 * already-deployed order_escrow `resolve` instruction (arbiter-gated) at the
 * platform-api call site; this module only tracks the off-chain workflow.
 */
export class DisputeNotFoundError extends Error {
  constructor(public disputeId: string) {
    super(`dispute_not_found: ${disputeId}`);
  }
}

export async function createDispute(
  db: Db,
  params: { taskOrderId: string; merchantId: string; raisedByAccountId: string; reason: string },
): Promise<string> {
  const [d] = await db
    .insert(disputes)
    .values({
      taskOrderId: params.taskOrderId,
      merchantId: params.merchantId,
      raisedByAccountId: params.raisedByAccountId,
      reason: params.reason,
      status: "open",
    })
    .returning();
  return d!.id;
}

export async function getDispute(db: Db, disputeId: string) {
  const [d] = await db.select().from(disputes).where(eq(disputes.id, disputeId)).limit(1);
  if (!d) throw new DisputeNotFoundError(disputeId);
  return d;
}

export async function listDisputesForOperator(db: Db) {
  return db
    .select({ dispute: disputes, taskOrder: taskOrders })
    .from(disputes)
    .innerJoin(taskOrders, eq(taskOrders.id, disputes.taskOrderId))
    .orderBy(desc(disputes.createdAt));
}

/** Same shape as listDisputesForOperator, scoped to one merchant — lets a merchant see disputes raised against their own orders (read-only; resolving stays operator-only). */
export async function listDisputesForMerchant(db: Db, merchantId: string) {
  return db
    .select({ dispute: disputes, taskOrder: taskOrders })
    .from(disputes)
    .innerJoin(taskOrders, eq(taskOrders.id, disputes.taskOrderId))
    .where(eq(disputes.merchantId, merchantId))
    .orderBy(desc(disputes.createdAt));
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ["reviewing", "closed"],
  reviewing: ["refunded", "released", "closed"],
  refunded: ["closed"],
  released: ["closed"],
};

export class InvalidDisputeTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`invalid_dispute_transition: ${from} -> ${to}`);
  }
}

export async function setDisputeStatus(
  db: Db,
  disputeId: string,
  status: "reviewing" | "refunded" | "released" | "closed",
  params: { resolvedByAccountId?: string; resolution?: string } = {},
): Promise<void> {
  const current = await getDispute(db, disputeId);
  if (!ALLOWED_TRANSITIONS[current.status]?.includes(status)) {
    throw new InvalidDisputeTransitionError(current.status, status);
  }
  await db
    .update(disputes)
    .set({ status, resolution: params.resolution, resolvedByAccountId: params.resolvedByAccountId, updatedAt: new Date() })
    .where(eq(disputes.id, disputeId));
}

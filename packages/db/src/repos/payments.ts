import { and, eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { paymentEvents, paymentProofs } from "../schema/index.js";

/**
 * Faz J §2 — real payment ledger. `payment_events` is the durable audit
 * trail (reconciled by scripts/ledger-check.ts); `payment_proofs` is pure
 * replay protection (chainId+txHash unique — a settled tx funds exactly one
 * paid request, enforced by whichever service tries to record it first).
 */
export interface RecordPaymentEventParams {
  accountId: string;
  merchantId?: string;
  taskId?: string;
  eventType: "research_fee" | "escrow_fund" | "escrow_release" | "escrow_refund" | "fee_refund";
  direction: "debit" | "credit";
  amountMicroUsdc: number;
  status?: "pending" | "confirmed" | "failed";
  chainId: number;
  tokenAddress?: string;
  fromAddress?: string;
  toAddress?: string;
  txHash?: string;
  idempotencyKey?: string;
}

export async function recordPaymentEvent(db: Db, params: RecordPaymentEventParams) {
  const [row] = await db
    .insert(paymentEvents)
    .values({
      accountId: params.accountId,
      merchantId: params.merchantId,
      taskId: params.taskId,
      eventType: params.eventType,
      direction: params.direction,
      amountMicroUsdc: BigInt(params.amountMicroUsdc),
      status: params.status ?? "pending",
      chainId: params.chainId,
      tokenAddress: params.tokenAddress,
      fromAddress: params.fromAddress,
      toAddress: params.toAddress,
      txHash: params.txHash,
      idempotencyKey: params.idempotencyKey,
      ...(params.status === "confirmed" ? { confirmedAt: new Date() } : {}),
    })
    .returning();
  return row!;
}

export async function markPaymentEventConfirmed(db: Db, id: string, txHash: string): Promise<void> {
  await db.update(paymentEvents).set({ status: "confirmed", txHash, confirmedAt: new Date() }).where(eq(paymentEvents.id, id));
}

export async function markPaymentEventFailed(db: Db, id: string, reason: string): Promise<void> {
  await db.update(paymentEvents).set({ status: "failed", failureReason: reason }).where(eq(paymentEvents.id, id));
}

/** Returns true iff this (chainId, txHash) hadn't been consumed yet (and is now recorded). */
export async function tryConsumePaymentProof(db: Db, chainId: number, txHash: string, idempotencyKey: string): Promise<boolean> {
  const inserted = await db
    .insert(paymentProofs)
    .values({ chainId, txHash, idempotencyKey })
    .onConflictDoNothing()
    .returning();
  return inserted.length > 0;
}

export async function sumConfirmedResearchFeesForTask(db: Db, taskId: string): Promise<bigint> {
  const rows = await db
    .select()
    .from(paymentEvents)
    .where(and(eq(paymentEvents.taskId, taskId), eq(paymentEvents.eventType, "research_fee"), eq(paymentEvents.status, "confirmed")));
  return rows.reduce((sum, r) => (r.direction === "debit" ? sum + r.amountMicroUsdc : sum - r.amountMicroUsdc), 0n);
}

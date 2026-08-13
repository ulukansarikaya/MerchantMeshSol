import { randomUUID } from "node:crypto";
import { getTransferInstruction } from "@solana-program/token";
import { address, createKeyPairSignerFromPrivateKeyBytes, type Address } from "@solana/kit";
import type Redis from "ioredis";
import {
  PaymentRequirements,
  assertTestnetOnly,
  createSolanaRpcClient,
  deriveAssociatedTokenAddress,
  hexToBytes,
  sendAndConfirmInstructions,
  MAX_PAYMENTS_PER_TASK,
  MAX_PAID_MERCHANTS,
  SESSION_WALLET_PER_DAY_MICRO,
  type SolanaEnvConfig,
  type PaymentProofTx,
  type MockPaymentProof,
} from "@merchantmesh/shared";
import { encodeProofHeader, signMockProof, encodeTxProofHeader, X_PAYMENT_HEADER } from "@merchantmesh/shared/mockpay";
import { loadMasterKey, decryptPrivateKey } from "@merchantmesh/shared/sessionWalletCrypto";
import {
  type Db,
  getPgTaskOwner,
  getSessionWallet,
  recordSessionWalletSpend,
  currentDailySpend,
  recordPaymentEvent,
  markPaymentEventConfirmed,
  markPaymentEventFailed,
  SessionWalletFrozenError,
} from "@merchantmesh/db";
import { nowSec, type BridgeDb } from "./db.js";

export class BudgetExceededError extends Error {
  constructor(
    public kind: "per_request" | "total",
    message: string,
  ) {
    super(message);
  }
}

export interface BudgetSnapshot {
  totalMicroUsdc: number;
  perRequestMaxMicroUsdc: number;
  spentMicroUsdc: number; // settled + pending (refunds excluded)
  remainingMicroUsdc: number;
}

export interface PaymentHandle {
  paymentId: string;
  header: string;
  settle(): Promise<void>;
  cancel(): Promise<void>; // request never reached the merchant → full credit back
  refundFee(): Promise<void>; // merchant auto-refunded the fee (e.g. failed negotiation)
}

/**
 * PaymentProvider — the bridge-side half of the x402 handshake. `pay()` is
 * async (Faz J: a real payment means broadcasting + confirming an on-chain
 * transfer before a proof even exists) — MockPaymentProvider's body is still
 * synchronous under the hood, just wrapped, so its behavior is unchanged.
 */
export interface PaymentProvider {
  pay(taskId: string, requirements: PaymentRequirements, merchantSlug: string, reason: string): Promise<PaymentHandle>;
  budget(taskId: string): BudgetSnapshot;
}

export interface BudgetConfig {
  totalMicroUsdc: number;
  perRequestMaxMicroUsdc: number;
}

export class MockPaymentProvider implements PaymentProvider {
  constructor(
    private db: BridgeDb,
    private secret: string,
  ) {}

  budget(taskId: string): BudgetSnapshot {
    const task = this.db
      .prepare("SELECT budget_total_micro, budget_per_request_micro FROM tasks WHERE task_id = ?")
      .get(taskId) as { budget_total_micro: number; budget_per_request_micro: number } | undefined;
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const spent = (this.db
      .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS s FROM spend WHERE task_id = ? AND status != 'refunded'")
      .get(taskId) as { s: number }).s;
    return {
      totalMicroUsdc: task.budget_total_micro,
      perRequestMaxMicroUsdc: task.budget_per_request_micro,
      spentMicroUsdc: spent,
      remainingMicroUsdc: task.budget_total_micro - spent,
    };
  }

  /**
   * Budget is enforced BEFORE the payment is issued, counting pending spends —
   * the agent physically cannot exceed the research budget.
   */
  async pay(taskId: string, requirements: PaymentRequirements, merchantSlug: string, reason: string): Promise<PaymentHandle> {
    const b = this.budget(taskId);
    if (requirements.amountMicroUsdc > b.perRequestMaxMicroUsdc) {
      throw new BudgetExceededError(
        "per_request",
        `Payment of ${requirements.amountMicroUsdc} µUSDC exceeds the per-request cap of ${b.perRequestMaxMicroUsdc} µUSDC (${requirements.endpoint}).`,
      );
    }
    if (requirements.amountMicroUsdc > b.remainingMicroUsdc) {
      throw new BudgetExceededError(
        "total",
        `Payment of ${requirements.amountMicroUsdc} µUSDC would exceed the research budget: spent+pending ${b.spentMicroUsdc}/${b.totalMicroUsdc} µUSDC.`,
      );
    }

    const paymentId = `pay_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO spend (payment_id, task_id, amount_micro, endpoint, merchant_slug, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(paymentId, taskId, requirements.amountMicroUsdc, requirements.endpoint, merchantSlug, reason, nowSec());

    const proof: MockPaymentProof = signMockProof(this.secret, {
      paymentId,
      taskId,
      amountMicroUsdc: requirements.amountMicroUsdc,
      payTo: requirements.payTo,
      endpoint: requirements.endpoint,
      idempotencyKey: requirements.idempotencyKey,
      issuedAt: nowSec(),
      provider: "mock",
    });

    const setStatus = (status: string): void => {
      this.db.prepare("UPDATE spend SET status = ? WHERE payment_id = ?").run(status, paymentId);
    };

    return {
      paymentId,
      header: encodeProofHeader(proof),
      settle: async () => setStatus("settled"),
      cancel: async () => setStatus("refunded"),
      refundFee: async () => setStatus("refunded"),
    };
  }
}

/** A short-lived Redis lock so one wallet never has two in-flight transactions racing for the same nonce. */
async function withWalletLock<T>(redis: Redis, walletAddress: string, fn: () => Promise<T>): Promise<T> {
  // Solana addresses are case-sensitive base58 — unlike EVM hex addresses, do NOT lowercase this key.
  const key = `session-wallet-lock:${walletAddress}`;
  const token = randomUUID();
  const deadline = Date.now() + 15_000;
  for (;;) {
    const got = await redis.set(key, token, "PX", 20_000, "NX");
    if (got === "OK") break;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for the session wallet lock on ${walletAddress}.`);
    await new Promise((r) => setTimeout(r, 100));
  }
  try {
    return await fn();
  } finally {
    // Only clear the lock if it's still ours (best-effort; a stale lock self-expires via PX anyway).
    const current = await redis.get(key);
    if (current === token) await redis.del(key);
  }
}

/**
 * SolanaPaymentProvider — Faz J §2. Every research micro-payment is a real
 * USDC (SPL) transfer signed by the caller's own Faz J session wallet (never
 * a shared/bridge-operated key). Budget enforcement (task cap, per-request
 * cap, payment count, distinct-merchant count, session wallet's rolling 24h
 * limit) all happen BEFORE anything is broadcast — once a transfer is sent
 * it is irreversible, so `cancel()` can only correct the local bookkeeping,
 * never undo a confirmed transaction (see DECISIONS.md).
 */
export class SolanaPaymentProvider implements PaymentProvider {
  private rpc: ReturnType<typeof createSolanaRpcClient>;

  constructor(
    private db: BridgeDb,
    private pg: Db,
    private chainConfig: SolanaEnvConfig,
    private usdcMint: Address,
    private redis: Redis,
  ) {
    this.rpc = createSolanaRpcClient(chainConfig);
  }

  budget(taskId: string): BudgetSnapshot {
    const task = this.db
      .prepare("SELECT budget_total_micro, budget_per_request_micro FROM tasks WHERE task_id = ?")
      .get(taskId) as { budget_total_micro: number; budget_per_request_micro: number } | undefined;
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    const spent = (this.db
      .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS s FROM spend WHERE task_id = ? AND status != 'refunded'")
      .get(taskId) as { s: number }).s;
    return {
      totalMicroUsdc: task.budget_total_micro,
      perRequestMaxMicroUsdc: task.budget_per_request_micro,
      spentMicroUsdc: spent,
      remainingMicroUsdc: task.budget_total_micro - spent,
    };
  }

  async pay(taskId: string, requirements: PaymentRequirements, merchantSlug: string, reason: string): Promise<PaymentHandle> {
    const b = this.budget(taskId);
    if (requirements.amountMicroUsdc > b.perRequestMaxMicroUsdc) {
      throw new BudgetExceededError("per_request", `Payment of ${requirements.amountMicroUsdc} µUSDC exceeds the per-request cap.`);
    }
    if (requirements.amountMicroUsdc > b.remainingMicroUsdc) {
      throw new BudgetExceededError("total", `Payment would exceed the research budget: ${b.spentMicroUsdc}/${b.totalMicroUsdc} µUSDC.`);
    }
    const paymentsSoFar = (this.db.prepare("SELECT COUNT(*) AS c FROM spend WHERE task_id = ? AND status != 'refunded'").get(taskId) as { c: number }).c;
    if (paymentsSoFar >= MAX_PAYMENTS_PER_TASK) {
      throw new BudgetExceededError("total", `Task already made ${paymentsSoFar} payments (max ${MAX_PAYMENTS_PER_TASK}).`);
    }
    const distinctMerchants = (this.db
      .prepare("SELECT COUNT(DISTINCT merchant_slug) AS c FROM spend WHERE task_id = ? AND status != 'refunded'")
      .get(taskId) as { c: number }).c;
    if (distinctMerchants >= MAX_PAID_MERCHANTS && !this.db.prepare("SELECT 1 FROM spend WHERE task_id = ? AND merchant_slug = ? LIMIT 1").get(taskId, merchantSlug)) {
      throw new BudgetExceededError("total", `Task already paid ${distinctMerchants} distinct merchants (max ${MAX_PAID_MERCHANTS}).`);
    }

    const accountId = await getPgTaskOwner(this.pg, taskId);
    if (!accountId) throw new Error("SolanaPaymentProvider requires a Postgres-tracked task (Faz C session) — no owning account found.");
    const wallet = await getSessionWallet(this.pg, accountId);
    if (!wallet) throw new Error("No session wallet provisioned for this account — call GET /session-wallet on platform-api first.");
    if (wallet.frozenAt) throw new SessionWalletFrozenError();

    const dailySpent = await currentDailySpend(this.pg, accountId);
    if (dailySpent + BigInt(requirements.amountMicroUsdc) > BigInt(SESSION_WALLET_PER_DAY_MICRO)) {
      throw new BudgetExceededError("total", "Session wallet's daily spend limit would be exceeded.");
    }

    assertTestnetOnly(this.chainConfig.cluster);
    const privateKeySeed = hexToBytes(decryptPrivateKey(wallet.encryptedKey, loadMasterKey()));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(privateKeySeed);

    const event = await recordPaymentEvent(this.pg, {
      accountId,
      taskId,
      eventType: "research_fee",
      direction: "debit",
      amountMicroUsdc: requirements.amountMicroUsdc,
      status: "pending",
      // Solana has no numeric chain id (cluster name + RPC URL is the whole
      // identity, see solanaConfig.ts) — 0 is a placeholder so this column
      // (kept from the EVM-era schema for now) doesn't collide with a real
      // EVM chain id. packages/db's schema should drop this column outright
      // in a later pass.
      chainId: 0,
      tokenAddress: this.usdcMint,
      fromAddress: wallet.address,
      toAddress: requirements.payTo,
      idempotencyKey: requirements.idempotencyKey,
    });

    let txSignature: string;
    try {
      txSignature = await withWalletLock(this.redis, wallet.address, async () => {
        const source = await deriveAssociatedTokenAddress(signer.address, this.usdcMint);
        const destination = await deriveAssociatedTokenAddress(address(requirements.payTo), this.usdcMint);
        const ix = getTransferInstruction({ source, destination, authority: signer, amount: BigInt(requirements.amountMicroUsdc) });
        return sendAndConfirmInstructions(this.rpc, signer, [ix]);
      });
    } catch (err) {
      await markPaymentEventFailed(this.pg, event.id, err instanceof Error ? err.message : String(err));
      throw err;
    }

    await markPaymentEventConfirmed(this.pg, event.id, txSignature);
    await recordSessionWalletSpend(this.pg, accountId, requirements.amountMicroUsdc);

    const paymentId = `pay_${randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO spend (payment_id, task_id, amount_micro, endpoint, merchant_slug, reason, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
      )
      .run(paymentId, taskId, requirements.amountMicroUsdc, requirements.endpoint, merchantSlug, reason, nowSec());

    const setStatus = (status: string): void => {
      this.db.prepare("UPDATE spend SET status = ? WHERE payment_id = ?").run(status, paymentId);
    };
    const proof: PaymentProofTx = { kind: "tx", txSignature, from: wallet.address as Address, idempotencyKey: requirements.idempotencyKey };

    return {
      paymentId,
      header: encodeTxProofHeader(proof),
      settle: async () => setStatus("settled"),
      // The transfer already landed on-chain and cannot be undone — this only
      // stops the LOCAL budget from double-counting a request that never
      // reached the merchant (e.g. a network failure on the retry).
      cancel: async () => setStatus("refunded"),
      refundFee: async () => setStatus("refunded"),
    };
  }
}

// ---------------------------------------------------------------------------
// Paid fetch — the 402 handshake used for every merchant request
// ---------------------------------------------------------------------------
export interface PaidResult {
  status: number;
  json: any;
  paidMicroUsdc: number;
  feeRefunded: boolean;
  idempotencyKey: string;
  replayed: boolean;
}

/**
 * 1. Send with Idempotency-Key. 2. On 402, pay through the PaymentProvider
 * (budget-checked) and retry with the proof. 3. Honor merchant fee refunds.
 */
export async function paidFetch(
  provider: PaymentProvider,
  taskId: string,
  url: string,
  body: unknown,
  opts: { merchantSlug: string; reason: string; idempotencyKey?: string },
): Promise<PaidResult> {
  const idempotencyKey = opts.idempotencyKey ?? `idem_${randomUUID()}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
  };
  const payload = JSON.stringify(body ?? {});

  const first = await fetch(url, { method: "POST", headers, body: payload });
  if (first.status !== 402) {
    return {
      status: first.status,
      json: await first.json(),
      paidMicroUsdc: 0,
      feeRefunded: false,
      idempotencyKey,
      replayed: first.headers.get("x-idempotent-replay") === "true",
    };
  }

  const challenge = (await first.json()) as { x402?: unknown };
  const requirements = PaymentRequirements.parse(challenge.x402);
  const handle = await provider.pay(taskId, requirements, opts.merchantSlug, opts.reason);

  let second: Response;
  try {
    second = await fetch(url, {
      method: "POST",
      headers: { ...headers, [X_PAYMENT_HEADER]: handle.header },
      body: payload,
    });
  } catch (err) {
    await handle.cancel(); // network failure → the merchant never saw the payment
    throw err;
  }

  const json = await second.json();
  const feeRefunded = second.headers.get("x-fee-refunded") === "true";
  if (feeRefunded) {
    await handle.refundFee();
  } else if (second.status === 402) {
    await handle.cancel(); // merchant rejected the proof → nothing was charged
  } else {
    await handle.settle();
  }
  return {
    status: second.status,
    json,
    paidMicroUsdc: feeRefunded || second.status === 402 ? 0 : requirements.amountMicroUsdc,
    feeRefunded,
    idempotencyKey,
    replayed: second.headers.get("x-idempotent-replay") === "true",
  };
}

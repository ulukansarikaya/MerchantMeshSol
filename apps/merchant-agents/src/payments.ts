import { createHash } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  deriveAssociatedTokenAddress,
  ENDPOINT_PRICES_MICRO,
  type PaidEndpoint,
  type PaymentRequirements,
} from "@merchantmesh/shared";
import {
  X_PAYMENT_HEADER,
  decodeProofHeader,
  verifyMockProofSig,
  decodeTxProofHeader,
} from "@merchantmesh/shared/mockpay";
import { getDb as getPgDb, tryConsumePaymentProof } from "@merchantmesh/db";
import { nowSec, type MerchantDb } from "./db.js";
import type { MerchantStore } from "./store.js";

const PROOF_MAX_AGE_SEC = 600;

export interface PaymentGateConfig {
  db: MerchantDb;
  store: MerchantStore;
  mockPayments: boolean;
  mockSecret: string;
  /** Cluster display name, e.g. "devnet"; "mock" in mock mode. */
  chainName: string;
  /** USDC mint address in real mode; symbol placeholder ("USDC") in mock mode. */
  usdcAsset: string;
  /** Faz J §2 — required for the real (non-mock) payment path to read confirmed transactions back. */
  rpc?: Rpc<SolanaRpcApi>;
  usdcMint?: Address;
}

function payloadHash(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/** Parsed SPL Token "transfer" instruction info, as returned by getTransaction's jsonParsed encoding. */
interface ParsedSplTransferInfo {
  source: string;
  destination: string;
  authority: string;
  amount: string;
}

/**
 * x402-style gate for paid merchant endpoints.
 *
 * Order of checks:
 *  1. Idempotency-Key is required on every paid request.
 *  2. Same key + same payload → replay the cached response (no new charge).
 *     Same key + different payload → 409.
 *  3. No payment proof → HTTP 402 with PaymentRequirements.
 *  4. Proof must verify (HMAC, amount, payee, endpoint, key, freshness) and be
 *     single-use. Then the handler runs and its response is cached.
 */
export function paymentGate(endpoint: PaidEndpoint, cfg: PaymentGateConfig): MiddlewareHandler {
  return async (c, next) => {
    const merchant = await cfg.store.getMerchant(c.req.param("id") ?? "");
    if (!merchant || !merchant.active) {
      return c.json({ error: "merchant_not_found" }, 404);
    }
    c.set("merchant", merchant);

    const idempotencyKey = c.req.header("idempotency-key");
    if (!idempotencyKey) {
      return c.json({ error: "idempotency_key_required", detail: "Every paid request must include an Idempotency-Key header." }, 400);
    }

    const rawBody = await c.req.text();
    c.set("rawBody", rawBody);
    const bodyHash = payloadHash(rawBody);

    const cached = cfg.db
      .prepare("SELECT payload_hash, response_status, response_json FROM idempotency WHERE key = ?")
      .get(idempotencyKey) as { payload_hash: string; response_status: number; response_json: string } | undefined;
    if (cached) {
      if (cached.payload_hash !== bodyHash) {
        return c.json({ error: "idempotency_conflict", detail: "Same Idempotency-Key with a different payload." }, 409);
      }
      c.header("x-idempotent-replay", "true");
      return c.newResponse(cached.response_json, cached.response_status as 200, {
        "content-type": "application/json",
      });
    }

    const amount = ENDPOINT_PRICES_MICRO[endpoint];
    const endpointPath = `/merchant/${merchant.slug}/${endpoint}`;
    const requirements: PaymentRequirements = {
      scheme: cfg.mockPayments ? "mock-hmac" : "spl-transfer",
      network: cfg.chainName,
      asset: cfg.usdcAsset,
      amountMicroUsdc: amount,
      payTo: merchant.wallet as PaymentRequirements["payTo"],
      endpoint: endpointPath,
      reason: `Paid merchant endpoint: ${endpoint} @ ${merchant.name}`,
      idempotencyKey,
      expiresAt: nowSec() + PROOF_MAX_AGE_SEC,
    };

    const proofHeader = c.req.header(X_PAYMENT_HEADER);
    if (!proofHeader) {
      return c.json({ x402: requirements }, 402);
    }

    if (!cfg.mockPayments) {
      if (!cfg.rpc || !cfg.usdcMint) {
        return c.json({ error: "real_payments_not_configured", detail: "rpc/usdcMint missing." }, 501);
      }
      const proof = decodeTxProofHeader(proofHeader);
      if (!proof) return c.json({ error: "invalid_payment_proof" }, 402);

      // Faz 0 §4 check 1/5 — the tx must exist and have succeeded.
      let tx;
      try {
        tx = await cfg.rpc
          .getTransaction(proof.txSignature as Parameters<typeof cfg.rpc.getTransaction>[0], {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
            encoding: "jsonParsed",
          })
          .send();
      } catch {
        return c.json({ error: "tx_not_found" }, 402);
      }
      if (!tx || tx.meta?.err) return c.json({ error: "tx_failed" }, 402);

      // Checks 2-4/5 — decode the SPL Token transfer instruction itself (not
      // the caller's claim): right destination token account, right amount.
      // "from" verification is deliberately kept to "matches the parsed
      // instruction's authority" rather than an extra platform-api round-trip
      // to resolve session-wallet ownership — the merchant only needs proof
      // IT got paid correctly, not who paid it (that account-level
      // bookkeeping is the payer's/platform-api's job).
      const merchantAta = await deriveAssociatedTokenAddress(merchant.wallet as Address, cfg.usdcMint);
      let transferAmount: bigint | undefined;
      let transferFrom: string | undefined;
      const instructions = tx.transaction.message.instructions as unknown[];
      for (const ix of instructions) {
        const parsed = ix as { program?: string; parsed?: { type?: string; info?: ParsedSplTransferInfo } };
        if (parsed.program !== "spl-token" || parsed.parsed?.type !== "transfer") continue;
        const info = parsed.parsed.info;
        if (!info || info.destination !== merchantAta) continue;
        transferAmount = BigInt(info.amount);
        transferFrom = info.authority;
        break;
      }
      if (transferAmount === undefined) {
        return c.json({ error: "payment_mismatch", detail: "No matching USDC transfer to this merchant found in the tx." }, 402);
      }
      if (transferAmount !== BigInt(amount)) {
        return c.json({ error: "payment_mismatch", detail: "Transfer amount does not match requirements." }, 402);
      }
      if (transferFrom !== proof.from) {
        return c.json({ error: "payment_mismatch", detail: "Transfer sender does not match the proof's `from`." }, 402);
      }
      if (proof.idempotencyKey !== idempotencyKey) {
        return c.json({ error: "payment_mismatch", detail: "Proof idempotency key does not match." }, 402);
      }

      // Check 5/5 — replay: a confirmed signature funds exactly one paid
      // request, enforced cross-service via Postgres (payment_proofs UNIQUE(chainId, txHash)).
      // chainId is a placeholder 0 here — Solana has no numeric chain id; see paymentClient.ts.
      const consumed = await tryConsumePaymentProof(getPgDb(), 0, proof.txSignature, idempotencyKey);
      if (!consumed) {
        return c.json({ error: "payment_proof_reused" }, 402);
      }
      c.set("paymentId", proof.txSignature);
    } else {
      const proof = decodeProofHeader(proofHeader);
      if (!proof || !verifyMockProofSig(cfg.mockSecret, proof)) {
        return c.json({ error: "invalid_payment_proof" }, 402);
      }
      if (proof.amountMicroUsdc !== amount || proof.payTo !== merchant.wallet) {
        return c.json({ error: "payment_mismatch", detail: "Proof amount or payee does not match requirements." }, 402);
      }
      if (proof.endpoint !== endpointPath || proof.idempotencyKey !== idempotencyKey) {
        return c.json({ error: "payment_mismatch", detail: "Proof endpoint or idempotency key does not match." }, 402);
      }
      if (Math.abs(nowSec() - proof.issuedAt) > PROOF_MAX_AGE_SEC) {
        return c.json({ error: "payment_proof_expired" }, 402);
      }
      const seen = cfg.db.prepare("SELECT payment_id FROM payments_seen WHERE payment_id = ?").get(proof.paymentId);
      if (seen) {
        return c.json({ error: "payment_proof_reused" }, 402);
      }
      cfg.db
        .prepare("INSERT INTO payments_seen (payment_id, idempotency_key, amount_micro, endpoint, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(proof.paymentId, idempotencyKey, amount, endpointPath, nowSec());
      c.set("paymentId", proof.paymentId);
    }

    await next();

    // Cache the handler's response for idempotent replay.
    const res = c.res;
    const responseBody = await res.clone().text();
    cfg.db
      .prepare("INSERT OR IGNORE INTO idempotency (key, endpoint, payload_hash, response_status, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(idempotencyKey, endpointPath, bodyHash, res.status, responseBody, nowSec());
  };
}

/** Marks the fee for this paid call as refunded (mock: the bridge re-credits its budget). */
export function markFeeRefunded(c: Context, db: MerchantDb): void {
  const paymentId = c.get("paymentId") as string | undefined;
  if (paymentId) {
    db.prepare("UPDATE payments_seen SET refunded = 1 WHERE payment_id = ?").run(paymentId);
  }
  c.header("x-fee-refunded", "true");
}

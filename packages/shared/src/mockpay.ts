// Node-only helper (subpath export "@merchantmesh/shared/mockpay").
// Mock-mode x402 payment proofs: HMAC-signed by the payer (bridge), verified
// locally by the merchant using the shared secret — no round-trip needed.
import { createHmac, timingSafeEqual } from "node:crypto";
import { MockPaymentProof, PaymentProofTx } from "./schemas.js";

export const X_PAYMENT_HEADER = "x-payment";

type ProofFields = Omit<MockPaymentProof, "sig">;

/** Canonical byte string signed by HMAC — field order is fixed here. */
function proofPayload(f: ProofFields): string {
  return JSON.stringify({
    paymentId: f.paymentId,
    taskId: f.taskId,
    amountMicroUsdc: f.amountMicroUsdc,
    payTo: f.payTo,
    endpoint: f.endpoint,
    idempotencyKey: f.idempotencyKey,
    issuedAt: f.issuedAt,
    provider: f.provider,
  });
}

export function signMockProof(secret: string, fields: ProofFields): MockPaymentProof {
  const sig = createHmac("sha256", secret).update(proofPayload(fields)).digest("hex");
  return { ...fields, sig };
}

export function encodeProofHeader(proof: MockPaymentProof): string {
  return Buffer.from(JSON.stringify(proof), "utf8").toString("base64url");
}

export function decodeProofHeader(header: string): MockPaymentProof | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    return MockPaymentProof.parse(parsed);
  } catch {
    return null;
  }
}

export function verifyMockProofSig(secret: string, proof: MockPaymentProof): boolean {
  const expected = createHmac("sha256", secret).update(proofPayload(proof)).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(proof.sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Faz J — real-mode (tx-hash) proofs. No HMAC: the merchant verifies the
// proof by reading the transaction back from the chain itself, not by
// trusting a signature from the payer.
// ---------------------------------------------------------------------------
export function encodeTxProofHeader(proof: PaymentProofTx): string {
  return Buffer.from(JSON.stringify(proof), "utf8").toString("base64url");
}

export function decodeTxProofHeader(header: string): PaymentProofTx | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    return PaymentProofTx.parse(parsed);
  } catch {
    return null;
  }
}

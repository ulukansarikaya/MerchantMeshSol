import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ENDPOINT_PRICES_MICRO } from "@merchantmesh/shared";
import { encodeProofHeader, signMockProof, X_PAYMENT_HEADER } from "@merchantmesh/shared/mockpay";
import { ALI, CEM, MINI, ZEYNEP, TEST_SECRET, createTestApp, paidHeaders } from "./helpers.js";

describe("M3 — x402 handshake", () => {
  it("returns 402 with payment requirements when unpaid", async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "idem_x1" },
      body: JSON.stringify({ items: [{ sku: "kiyma-dana", qty: 1 }] }),
    });
    expect(res.status).toBe(402);
    const { x402 } = (await res.json()) as any;
    expect(x402).toMatchObject({
      scheme: "mock-hmac",
      network: "mock",
      asset: "USDC",
      amountMicroUsdc: 500,
      payTo: ALI.wallet,
      endpoint: `/merchant/${ALI.slug}/quote`,
      idempotencyKey: "idem_x1",
    });
    expect(typeof x402.expiresAt).toBe("number");
    expect(x402.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("requires an Idempotency-Key on every paid request", async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "kiyma-dana", qty: 1 }] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toBe("idempotency_key_required");
  });

  it("rejects a proof with a bad signature / wrong amount / reused id", async () => {
    const { app } = await createTestApp();
    const key = `idem_${randomUUID()}`;
    const good = signMockProof(TEST_SECRET, {
      paymentId: `pay_${randomUUID()}`,
      taskId: "t",
      amountMicroUsdc: ENDPOINT_PRICES_MICRO.quote,
      payTo: ALI.wallet,
      endpoint: `/merchant/${ALI.slug}/quote`,
      idempotencyKey: key,
      issuedAt: Math.floor(Date.now() / 1000),
      provider: "mock",
    });
    const body = JSON.stringify({ items: [{ sku: "kiyma-dana", qty: 1 }] });

    // Wrong secret
    const badSig = signMockProof("wrong-secret", { ...good });
    let res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, [X_PAYMENT_HEADER]: encodeProofHeader(badSig) },
      body,
    });
    expect(res.status).toBe(402);

    // Wrong amount (signed correctly but for a different price)
    const wrongAmount = signMockProof(TEST_SECRET, { ...good, amountMicroUsdc: 1 });
    res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, [X_PAYMENT_HEADER]: encodeProofHeader(wrongAmount) },
      body,
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as any).error).toBe("payment_mismatch");

    // Valid once...
    res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key, [X_PAYMENT_HEADER]: encodeProofHeader(good) },
      body,
    });
    expect(res.status).toBe(200);

    // ...but the same paymentId cannot pay for a different request.
    res = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": `idem_${randomUUID()}`, [X_PAYMENT_HEADER]: encodeProofHeader({ ...good, idempotencyKey: `other` }) },
      body,
    });
    expect(res.status).toBe(402);
  });
});

describe("M3 — idempotency", () => {
  it("replays the cached response for the same key + payload (no double effects)", async () => {
    const { app, db } = await createTestApp();
    const key = `idem_${randomUUID()}`;
    const headers = paidHeaders("reserve", CEM, key);
    const body = JSON.stringify({ sku: "ekmek", qty: 2 });

    const first = await app.request(`/merchant/cem-firin/reserve`, { method: "POST", headers, body });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as any;

    const replay = await app.request(`/merchant/cem-firin/reserve`, { method: "POST", headers, body });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("x-idempotent-replay")).toBe("true");
    expect((await replay.json()) as any).toEqual(firstBody); // same reservationId, not a new one

    // Stock was only decremented once — no duplicate reservation.
    const stock = (db.prepare("SELECT stock_qty AS s FROM inventory WHERE merchant_id = 4 AND sku = 'ekmek'").get() as any).s;
    expect(stock).toBe(0);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM reservations").get() as any).c;
    expect(count).toBe(1);
  });

  it("returns 409 for the same key with a different payload", async () => {
    const { app } = await createTestApp();
    const key = `idem_${randomUUID()}`;
    const headers = paidHeaders("quote", ALI, key);
    const first = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ sku: "kiyma-dana", qty: 1 }] }),
    });
    expect(first.status).toBe(200);

    const conflict = await app.request(`/merchant/${ALI.slug}/quote`, {
      method: "POST",
      headers,
      body: JSON.stringify({ items: [{ sku: "kiyma-dana", qty: 2 }] }),
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as any).error).toBe("idempotency_conflict");
  });
});

describe("M3 — negotiation fee refund", () => {
  it("keeps the fee when the discount beats the fee", async () => {
    const { app } = await createTestApp();
    const q = await app.request(`/merchant/${ZEYNEP.slug}/quote`, {
      method: "POST",
      headers: paidHeaders("quote", ZEYNEP),
      body: JSON.stringify({ items: [{ sku: "domates", qty: 1 }, { sku: "sogan", qty: 1 }, { sku: "maydanoz", qty: 1 }] }),
    });
    const { quote } = (await q.json()) as any;
    const res = await app.request(`/merchant/${ZEYNEP.slug}/negotiate`, {
      method: "POST",
      headers: paidHeaders("negotiate", ZEYNEP),
      body: JSON.stringify({ quoteId: quote.quoteId, requestedDiscountBps: 1000 }),
    });
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(true);
    expect(body.feeRefunded).toBe(false);
    expect(res.headers.get("x-fee-refunded")).toBeNull();
    expect(body.discountMicroUsdc).toBeGreaterThan(ENDPOINT_PRICES_MICRO.negotiate);
    expect(body.quote.nonce).toBeGreaterThan(quote.nonce);
  });

  it("auto-refunds the fee when the achievable discount is below the fee", async () => {
    const { app, db } = await createTestApp();
    // Quote a single cheap item where max discount < 0.002 USDC fee.
    const q = await app.request(`/merchant/${ZEYNEP.slug}/quote`, {
      method: "POST",
      headers: paidHeaders("quote", ZEYNEP),
      body: JSON.stringify({ items: [{ sku: "maydanoz", qty: 1 }] }),
    });
    const { quote } = (await q.json()) as any;
    // 300000 micro at counter 50 bps (requested 100/2) → 1500 < 2000 fee.
    const res = await app.request(`/merchant/${ZEYNEP.slug}/negotiate`, {
      method: "POST",
      headers: paidHeaders("negotiate", ZEYNEP),
      body: JSON.stringify({ quoteId: quote.quoteId, requestedDiscountBps: 100 }),
    });
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(false);
    expect(body.reason).toBe("discount_below_fee");
    expect(body.feeRefunded).toBe(true);
    expect(res.headers.get("x-fee-refunded")).toBe("true");
    const refunded = (db.prepare("SELECT COUNT(*) AS c FROM payments_seen WHERE refunded = 1").get() as any).c;
    expect(refunded).toBe(1);
    // Original quote still active for ordering.
    const status = (db.prepare("SELECT status FROM quotes WHERE quote_id = ?").get(quote.quoteId) as any).status;
    expect(status).toBe("active");
  });

  it("refunds the fee at merchants without negotiation", async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/merchant/mini-market/negotiate`, {
      method: "POST",
      headers: paidHeaders("negotiate", MINI),
      body: JSON.stringify({ quoteId: "q_none", requestedDiscountBps: 500 }),
    });
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(false);
    expect(body.feeRefunded).toBe(true);
  });
});

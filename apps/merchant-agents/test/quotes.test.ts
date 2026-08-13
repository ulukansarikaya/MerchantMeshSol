import { describe, expect, it } from "vitest";
import { devAddress, keccak256HexUtf8, verifyQuoteSignature, type SignedQuote } from "@merchantmesh/shared";
import { ALI, CEM, ZEYNEP, createTestApp, paidHeaders } from "./helpers.js";

const BUYER = devAddress(5);
const CODE_HASH = keccak256HexUtf8("1234");

async function getQuote(app: any, merchant: { slug: string; wallet: string } = ALI, items = [{ sku: "kiyma-dana", qty: 1 }]): Promise<SignedQuote> {
  const res = await app.request(`/merchant/${merchant.slug}/quote`, {
    method: "POST",
    headers: paidHeaders("quote", merchant),
    body: JSON.stringify({ items, taskId: "t_test" }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as any).quote;
}

describe("M1 — discovery", () => {
  it("returns all 5 active merchants sorted by distance", async () => {
    const { app } = await createTestApp();
    const res = await app.request("/discovery?lat=39.9208&lng=32.8541&radius=1000");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.count).toBe(5);
    const slugs = body.merchants.map((m: any) => m.slug);
    expect(slugs).toEqual(["ali-kasap", "can-kasap", "zeynep-manav", "mini-market", "cem-firin"]);
    const distances = body.merchants.map((m: any) => m.distanceM);
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(body.merchants[0].verification).toEqual({ identity: true, attestation: true, stake: true });
  });
});

describe("M2 — quotes", () => {
  it("issues a signed quote that verifies against the merchant wallet", async () => {
    const { app } = await createTestApp();
    const quote = await getQuote(app);
    // Ali Kasap has negotiation enabled, so as of Faz 3 the initial /quote
    // already goes through MockDiscountProvider + pricingPolicy's deterministic
    // clamp (see discountProvider.ts) — no longer a flat list-price echo.
    // 4_500_000 list price, mock proposes floor(600/4)*0.5=75bps, clamped
    // identically (75 < maxDiscountBps 600, well above the min-price floor).
    expect(quote.totalMicroUsdc).toBe(4_466_250);
    expect(quote.totalMicroUsdc).toBeLessThan(4_500_000);
    expect(quote.totalMicroUsdc).toBeGreaterThanOrEqual(4_200_000); // never below kiyma-dana's min_price_micro
    expect(quote.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(await verifyQuoteSignature(quote)).toBe(true);
  });

  it("never quotes below minPrice, even under maximal negotiation", async () => {
    const { app, db } = await createTestApp();
    const quote = await getQuote(app, ZEYNEP, [
      { sku: "domates", qty: 1 },
      { sku: "sogan", qty: 1 },
      { sku: "maydanoz", qty: 1 },
    ]);
    const res = await app.request(`/merchant/${ZEYNEP.slug}/negotiate`, {
      method: "POST",
      headers: paidHeaders("negotiate", ZEYNEP),
      body: JSON.stringify({ quoteId: quote.quoteId, requestedDiscountBps: 3000 }),
    });
    const body = (await res.json()) as any;
    expect(body.accepted).toBe(true);
    const minTotal = (db
      .prepare("SELECT SUM(min_price_micro) AS m FROM inventory WHERE merchant_id = 3 AND sku IN ('domates','sogan','maydanoz')")
      .get() as any).m;
    expect(body.quote.totalMicroUsdc).toBeGreaterThanOrEqual(minTotal);
    for (const item of body.quote.items) {
      const min = (db
        .prepare("SELECT min_price_micro AS m FROM inventory WHERE merchant_id = 3 AND sku = ?")
        .get(item.sku) as any).m;
      expect(item.unitPriceMicroUsdc).toBeGreaterThanOrEqual(min);
    }
  });

  it("rejects an expired quote at order time", async () => {
    const { app, db } = await createTestApp();
    const quote = await getQuote(app);
    db.prepare("UPDATE quotes SET valid_until = ? WHERE quote_id = ?").run(1, quote.quoteId);
    const res = await app.request(`/merchant/${ALI.slug}/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId: quote.quoteId, taskId: "t_test", buyer: BUYER, pickupCodeHash: CODE_HASH }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("quote_expired");
  });

  it("rejects a superseded quote at order time (nonce chain)", async () => {
    const { app } = await createTestApp();
    const quote = await getQuote(app, ZEYNEP, [{ sku: "domates", qty: 2 }]);
    const neg = await app.request(`/merchant/${ZEYNEP.slug}/negotiate`, {
      method: "POST",
      headers: paidHeaders("negotiate", ZEYNEP),
      body: JSON.stringify({ quoteId: quote.quoteId, requestedDiscountBps: 2000 }),
    });
    expect(((await neg.json()) as any).accepted).toBe(true);
    const res = await app.request(`/merchant/${ZEYNEP.slug}/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId: quote.quoteId, taskId: "t_test", buyer: BUYER, pickupCodeHash: CODE_HASH }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("quote_superseded");
  });

  it("rejects a tampered quote via signature verification", async () => {
    const { app, db } = await createTestApp();
    const quote = await getQuote(app);
    // Tamper the stored total — the stored signature no longer matches.
    db.prepare("UPDATE quotes SET total_micro = 1 WHERE quote_id = ?").run(quote.quoteId);
    const res = await app.request(`/merchant/${ALI.slug}/order`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteId: quote.quoteId, taskId: "t_test", buyer: BUYER, pickupCodeHash: CODE_HASH }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).error).toBe("quote_signature_invalid");
  });

  it("worker expires quotes past validUntil", async () => {
    const { app, db, worker } = await createTestApp();
    const quote = await getQuote(app);
    db.prepare("UPDATE quotes SET valid_until = 1 WHERE quote_id = ?").run(quote.quoteId);
    const result = await worker.tick();
    expect(result.expiredQuotes).toBe(1);
    const row = db.prepare("SELECT status FROM quotes WHERE quote_id = ?").get(quote.quoteId) as any;
    expect(row.status).toBe("expired");
  });
});

describe("M2 — reservations", () => {
  it("locks stock with TTL and releases it on expiry", async () => {
    const { app, db, worker } = await createTestApp();
    const res = await app.request(`/merchant/cem-firin/reserve`, {
      method: "POST",
      headers: paidHeaders("reserve", CEM),
      body: JSON.stringify({ sku: "ekmek", qty: 2 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ttlSeconds).toBe(600);
    let stock = (db.prepare("SELECT stock_qty AS s FROM inventory WHERE merchant_id = 4 AND sku = 'ekmek'").get() as any).s;
    expect(stock).toBe(0); // last 2 loaves locked

    db.prepare("UPDATE reservations SET expires_at = 1 WHERE reservation_id = ?").run(body.reservationId);
    const tickResult = await worker.tick();
    expect(tickResult.releasedReservations).toBe(1);
    stock = (db.prepare("SELECT stock_qty AS s FROM inventory WHERE merchant_id = 4 AND sku = 'ekmek'").get() as any).s;
    expect(stock).toBe(2);
  });

  it("rejects reservation at non-reservation merchants", async () => {
    const { app } = await createTestApp();
    const res = await app.request(`/merchant/${ALI.slug}/reserve`, {
      method: "POST",
      headers: paidHeaders("reserve", ALI),
      body: JSON.stringify({ sku: "kiyma-dana", qty: 1 }),
    });
    expect(res.status).toBe(422);
  });
});

import { describe, expect, it } from "vitest";
import {
  usdcToMicro,
  microToUsdc,
  applyBps,
  haversineMeters,
  HOME_POINT,
  SEED_MERCHANTS,
  signQuote,
  verifyQuoteSignature,
  hashQuote,
  devKeypairSigner,
  devAddress,
  canTransition,
  type Quote,
} from "../src/index.js";

describe("usdc helpers", () => {
  it("parses and formats micro-USDC without floats", () => {
    expect(usdcToMicro("4.50")).toBe(4_500_000);
    expect(usdcToMicro("0.0002")).toBe(200);
    expect(usdcToMicro("0.01")).toBe(10_000);
    expect(microToUsdc(4_500_000)).toBe("4.50");
    expect(microToUsdc(200)).toBe("0.0002");
    expect(microToUsdc(0)).toBe("0.00");
  });

  it("rejects invalid amounts", () => {
    expect(() => usdcToMicro("abc")).toThrow();
    expect(() => usdcToMicro("1.1234567")).toThrow();
    expect(() => microToUsdc(-1)).toThrow();
    expect(() => microToUsdc(1.5)).toThrow();
  });

  it("applies bps deterministically (floor)", () => {
    expect(applyBps(1_700_000, 400)).toBe(68_000);
    expect(applyBps(999, 100)).toBe(9);
  });
});

describe("geo", () => {
  it("seed merchants land at the spec'd distances (±5m)", () => {
    const dist = Object.fromEntries(
      SEED_MERCHANTS.map((m) => [m.slug, haversineMeters(HOME_POINT.lat, HOME_POINT.lng, m.lat, m.lng)]),
    );
    expect(dist["ali-kasap"]).toBeGreaterThanOrEqual(167);
    expect(dist["ali-kasap"]).toBeLessThanOrEqual(177);
    expect(dist["can-kasap"]).toBeGreaterThanOrEqual(300);
    expect(dist["can-kasap"]).toBeLessThanOrEqual(310);
    expect(dist["zeynep-manav"]).toBeGreaterThanOrEqual(337);
    expect(dist["zeynep-manav"]).toBeLessThanOrEqual(347);
    expect(dist["mini-market"]).toBeGreaterThanOrEqual(373);
    expect(dist["mini-market"]).toBeLessThanOrEqual(383);
    expect(dist["cem-firin"]).toBeGreaterThanOrEqual(382);
    expect(dist["cem-firin"]).toBeLessThanOrEqual(392);
  });
});

describe("quote signatures (Ed25519)", () => {
  const quote: Quote = {
    quoteId: "q_test_0001",
    merchantId: 1,
    merchantWallet: devAddress(0),
    items: [{ sku: "kiyma-dana", qty: 1, unitPriceMicroUsdc: 4_500_000 }],
    totalMicroUsdc: 4_500_000,
    validUntil: Math.floor(Date.now() / 1000) + 300,
    nonce: 1,
  };

  it("signs and verifies against the merchant wallet", async () => {
    const signed = await signQuote(await devKeypairSigner(0), quote);
    expect(signed.signature.length).toBeGreaterThan(0);
    expect(await verifyQuoteSignature(signed)).toBe(true);
  });

  it("rejects a tampered quote", async () => {
    const signed = await signQuote(await devKeypairSigner(0), quote);
    const tampered = { ...signed, totalMicroUsdc: 1 };
    expect(await verifyQuoteSignature(tampered)).toBe(false);
  });

  it("rejects a quote signed by the wrong key", async () => {
    const signed = await signQuote(await devKeypairSigner(1), quote); // Can's key, Ali's wallet
    expect(await verifyQuoteSignature(signed)).toBe(false);
  });

  it("hashes deterministically", async () => {
    expect(await hashQuote(quote)).toEqual(await hashQuote({ ...quote }));
  });

  it("hashes differently when the quote content changes", async () => {
    expect(await hashQuote(quote)).not.toEqual(await hashQuote({ ...quote, nonce: quote.nonce + 1 }));
  });
});

describe("order state machine (v2)", () => {
  it("allows the full happy path incl. merchant acceptance and funding", () => {
    expect(canTransition("quoted", "user_selected")).toBe(true);
    expect(canTransition("user_selected", "merchant_pending")).toBe(true);
    expect(canTransition("merchant_pending", "merchant_confirmed")).toBe(true);
    expect(canTransition("merchant_confirmed", "awaiting_funding")).toBe(true);
    expect(canTransition("awaiting_funding", "paid_in_escrow")).toBe(true);
    expect(canTransition("paid_in_escrow", "preparing")).toBe(true);
    expect(canTransition("preparing", "ready")).toBe(true);
    expect(canTransition("ready", "completed")).toBe(true);
  });

  it("allows merchant rejection and accept-timeout as terminal exits", () => {
    expect(canTransition("merchant_pending", "merchant_rejected")).toBe(true);
    expect(canTransition("merchant_pending", "expired")).toBe(true);
    expect(canTransition("merchant_rejected", "merchant_confirmed")).toBe(false);
  });

  it("never allows escrow to be funded before merchant confirmation", () => {
    expect(canTransition("quoted", "paid_in_escrow")).toBe(false);
    expect(canTransition("user_selected", "paid_in_escrow")).toBe(false);
    expect(canTransition("merchant_pending", "paid_in_escrow")).toBe(false);
    expect(canTransition("merchant_pending", "awaiting_funding")).toBe(false);
    expect(canTransition("merchant_confirmed", "paid_in_escrow")).toBe(false); // must pass through awaiting_funding
  });

  it("blocks illegal transitions", () => {
    expect(canTransition("completed", "refunded")).toBe(false);
    expect(canTransition("refunded", "preparing")).toBe(false);
  });
});

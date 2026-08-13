import { describe, expect, it } from "vitest";
import type { QuoteItem, MerchantDecision } from "@merchantmesh/shared";
import { createTestApp } from "./helpers.js";
import { createMerchantStore } from "../src/store.js";
import { buildQuoteItems } from "../src/quotes.js";
import { decideAndApplyDiscount } from "../src/pricingPolicy.js";
import type { DiscountDecisionProvider } from "../src/discountProvider.js";
import { MockDiscountProvider } from "../src/discountProvider.js";

/** merchant_id=1 is Ali Kasap (negotiation enabled, maxDiscountBps=600) — see packages/shared/src/merchants.ts. */
const ALI_ID = 1;
const KIYMA_MIN_PRICE = 4_200_000; // kiyma-dana's min_price_micro

async function setup() {
  const { db } = await createTestApp();
  const store = createMerchantStore(db);
  const merchant = (await store.getMerchant(String(ALI_ID)))!;
  const { items, total } = await buildQuoteItems(store, merchant, [{ sku: "kiyma-dana", qty: 1 }]);
  return { db, store, merchant, items, total };
}

class ThrowingProvider implements DiscountDecisionProvider {
  readonly name = "broken";
  async decide(): Promise<MerchantDecision> {
    throw new Error("upstream exploded");
  }
}

class TimeoutProvider implements DiscountDecisionProvider {
  readonly name = "timeout";
  async decide(): Promise<MerchantDecision> {
    const err = new Error("aborted");
    err.name = "TimeoutError";
    throw err;
  }
}

class AdversarialProvider implements DiscountDecisionProvider {
  readonly name = "adversarial";
  async decide(): Promise<MerchantDecision> {
    // Way above merchant.maxDiscountBps (600) and the schema's own max(2000) —
    // simulates a misbehaving/compromised LLM response reaching the policy layer.
    return { proposedDiscountBps: 2000, rationale: "trust me" };
  }
}

class ZeroProvider implements DiscountDecisionProvider {
  readonly name = "zero";
  async decide(): Promise<MerchantDecision> {
    return { proposedDiscountBps: 0, rationale: "no discount warranted" };
  }
}

describe("pricingPolicy.decideAndApplyDiscount", () => {
  it("never applies a discount below the line's min price, even when the provider proposes the max possible bps", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await decideAndApplyDiscount(undefined, store, new AdversarialProvider(), merchant, items, total);
    expect(result.totalMicroUsdc).toBeGreaterThanOrEqual(KIYMA_MIN_PRICE);
    // Clamped to merchant.max_discount_bps (600bps = 6%), not the proposed 2000bps.
    const maxPossibleDiscount = Math.floor((total * 600) / 10000);
    expect(result.discountMicroUsdc).toBeLessThanOrEqual(maxPossibleDiscount);
  });

  it("applies zero discount when the provider proposes zero", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await decideAndApplyDiscount(undefined, store, new ZeroProvider(), merchant, items, total);
    expect(result.totalMicroUsdc).toBe(total);
    expect(result.discountMicroUsdc).toBe(0);
  });

  it("falls back to the undiscounted quote when the provider throws", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await decideAndApplyDiscount(undefined, store, new ThrowingProvider(), merchant, items, total);
    expect(result).toEqual({ items, totalMicroUsdc: total, discountMicroUsdc: 0 });
  });

  it("falls back to the undiscounted quote on a timeout-shaped error", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await decideAndApplyDiscount(undefined, store, new TimeoutProvider(), merchant, items, total);
    expect(result).toEqual({ items, totalMicroUsdc: total, discountMicroUsdc: 0 });
  });

  it("respects a per-SKU maxDiscountBps override tighter than the merchant-wide cap", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await decideAndApplyDiscount(undefined, store, new AdversarialProvider(), merchant, items, total, { productMaxDiscountBps: 50 });
    const maxPossibleDiscount = Math.floor((total * 50) / 10000);
    expect(result.discountMicroUsdc).toBeLessThanOrEqual(maxPossibleDiscount);
  });

  it("rate-limits a single merchant past the per-minute cap, degrading to the undiscounted quote", async () => {
    const { store, merchant, items, total } = await setup();
    const provider = new MockDiscountProvider();
    let lastResult;
    // 11 calls > the 10/minute cap in pricingPolicy.ts.
    for (let i = 0; i < 11; i++) {
      lastResult = await decideAndApplyDiscount(undefined, store, provider, merchant, items, total);
    }
    expect(lastResult).toEqual({ items, totalMicroUsdc: total, discountMicroUsdc: 0 });
  });
});

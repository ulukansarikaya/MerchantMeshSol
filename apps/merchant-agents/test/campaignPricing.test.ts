import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";
import { createMerchantStore } from "../src/store.js";
import { buildQuoteItems } from "../src/quotes.js";
import { applyCampaignRules, type CampaignForPricing } from "../src/campaignPricing.js";

/** merchant_id=1 is Ali Kasap — kiyma-dana priceMicroUsdc 4_500_000, minPriceMicroUsdc 4_200_000. See packages/shared/src/merchants.ts. */
const ALI_ID = 1;
const KIYMA_MIN_PRICE = 4_200_000;
const KIYMA_PRICE = 4_500_000;

async function setup() {
  const { db } = await createTestApp();
  const store = createMerchantStore(db);
  const merchant = (await store.getMerchant(String(ALI_ID)))!;
  const { items, total } = await buildQuoteItems(store, merchant, [{ sku: "kiyma-dana", qty: 1 }]);
  return { store, merchant, items, total };
}

function percentOffCampaign(id: string, bps: number, opts: Partial<CampaignForPricing> = {}): CampaignForPricing {
  return {
    id,
    stackPolicy: "exclusive",
    rules: [{ ruleType: "percent_off", discountType: "percent", discountValue: BigInt(bps), maximumDiscountMicroUsdc: null }],
    ...opts,
  };
}

function fixedOffCampaign(id: string, amountMicro: number, maxCapMicro: number | null, opts: Partial<CampaignForPricing> = {}): CampaignForPricing {
  return {
    id,
    stackPolicy: "exclusive",
    rules: [
      {
        ruleType: "fixed_off",
        discountType: "fixed",
        discountValue: BigInt(amountMicro),
        maximumDiscountMicroUsdc: maxCapMicro === null ? null : BigInt(maxCapMicro),
      },
    ],
    ...opts,
  };
}

describe("campaignPricing.applyCampaignRules", () => {
  it("applies a percent_off campaign within the price floor", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await applyCampaignRules(store, merchant, items, total, [percentOffCampaign("c1", 500)]); // 5%
    const expectedDiscount = Math.floor((total * 500) / 10_000);
    expect(result.discountMicroUsdc).toBe(expectedDiscount);
    expect(result.totalMicroUsdc).toBe(total - expectedDiscount);
    expect(result.totalMicroUsdc).toBeGreaterThanOrEqual(KIYMA_MIN_PRICE);
    expect(result.appliedCampaignIds).toEqual(["c1"]);
  });

  it("caps a fixed_off campaign at its own maximumDiscountMicroUsdc", async () => {
    const { store, merchant, items, total } = await setup();
    // Request 200_000 off but cap it at 50_000.
    const result = await applyCampaignRules(store, merchant, items, total, [fixedOffCampaign("c1", 200_000, 50_000)]);
    expect(result.discountMicroUsdc).toBe(50_000);
    expect(result.totalMicroUsdc).toBe(total - 50_000);
  });

  it("never discounts below the aggregate minimum price, even under an adversarial 100%-off rule", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await applyCampaignRules(store, merchant, items, total, [percentOffCampaign("c1", 10_000)]); // 100% off
    expect(result.totalMicroUsdc).toBeGreaterThanOrEqual(KIYMA_MIN_PRICE);
    expect(result.discountMicroUsdc).toBe(KIYMA_PRICE - KIYMA_MIN_PRICE);
  });

  it("an exclusive campaign applies alone — a lower-priority campaign after it is ignored", async () => {
    const { store, merchant, items, total } = await setup();
    const campaigns = [percentOffCampaign("high", 500, { stackPolicy: "exclusive" }), percentOffCampaign("low", 1000)];
    const result = await applyCampaignRules(store, merchant, items, total, campaigns);
    expect(result.appliedCampaignIds).toEqual(["high"]);
    expect(result.discountMicroUsdc).toBe(Math.floor((total * 500) / 10_000));
  });

  it("stackable campaigns sum on top of each other, each still floor-protected", async () => {
    const { store, merchant, items, total } = await setup();
    const campaigns = [
      percentOffCampaign("first", 300, { stackPolicy: "stackable" }),
      percentOffCampaign("second", 300, { stackPolicy: "stackable" }),
    ];
    const result = await applyCampaignRules(store, merchant, items, total, campaigns);
    expect(result.appliedCampaignIds).toEqual(["first", "second"]);
    // Second 3% applies to the already-discounted total, not the original.
    const afterFirst = total - Math.floor((total * 300) / 10_000);
    const afterSecond = afterFirst - Math.floor((afterFirst * 300) / 10_000);
    expect(result.totalMicroUsdc).toBe(Math.max(afterSecond, KIYMA_MIN_PRICE));
  });

  it("ignores rule types other than percent_off/fixed_off (not yet evaluated)", async () => {
    const { store, merchant, items, total } = await setup();
    const bogo: CampaignForPricing = {
      id: "bogo1",
      stackPolicy: "exclusive",
      rules: [{ ruleType: "bogo", discountType: "percent", discountValue: 9999n, maximumDiscountMicroUsdc: null }],
    };
    const result = await applyCampaignRules(store, merchant, items, total, [bogo]);
    expect(result.discountMicroUsdc).toBe(0);
    expect(result.totalMicroUsdc).toBe(total);
    expect(result.appliedCampaignIds).toEqual([]);
  });

  it("returns the input unchanged when there are no campaigns", async () => {
    const { store, merchant, items, total } = await setup();
    const result = await applyCampaignRules(store, merchant, items, total, []);
    expect(result).toEqual({ items, totalMicroUsdc: total, discountMicroUsdc: 0, appliedCampaignIds: [] });
  });
});

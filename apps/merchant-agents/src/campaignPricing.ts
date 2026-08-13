import { listActiveCampaignsForMerchant, type Db } from "@merchantmesh/db";
import { applyBps, type QuoteItem } from "@merchantmesh/shared";
import { spreadDiscount } from "./quotes.js";
import type { MerchantStore } from "./store.js";
import type { MerchantRow } from "./db.js";

export interface CampaignDiscountResult {
  items: QuoteItem[];
  totalMicroUsdc: number;
  discountMicroUsdc: number;
  appliedCampaignIds: string[];
}

export interface CampaignRuleForPricing {
  ruleType: string;
  discountType: string; // "percent" | "fixed" at the DB layer; not narrowed to a union since the column is plain text
  discountValue: bigint;
  maximumDiscountMicroUsdc: bigint | null;
}

export interface CampaignForPricing {
  id: string;
  stackPolicy: string;
  rules: CampaignRuleForPricing[];
}

/**
 * Pure discount composition — no DB access, so this is the part actually
 * unit-tested (see test/campaignPricing.test.ts). Only `percent_off` and
 * `fixed_off` rules are evaluated; `bogo`/`bundle`/`min_basket`/`time_window`/
 * `loyalty`/`first_order` stay schema/API-ready but unevaluated (see
 * README.md's Faz 2/3 section) — implementing all 8 rule semantics is a
 * bigger effort than this pass covers. Unlike `applyBoundedDiscount`
 * (negotiation), campaign discounts are NOT capped by
 * `merchant.max_discount_bps` — that cap is specifically the negotiation
 * ceiling; a merchant's own campaign is a separate authority, only ever
 * bounded by the hard price floor (`minTotalFor`, enforced inside
 * `spreadDiscount`) and its own `maximumDiscountMicroUsdc`.
 *
 * `stackPolicy: "exclusive"` stops after that campaign's rules are applied
 * (no other campaign combines with it); `"stackable"` keeps applying
 * subsequent (lower-priority) campaigns on top of the already-discounted
 * running total, each independently floor-protected via `spreadDiscount`.
 * Callers are expected to pass `campaigns` already sorted highest-priority
 * first (see `listActiveCampaignsForMerchant`).
 */
export async function applyCampaignRules(
  store: MerchantStore,
  merchant: MerchantRow,
  items: QuoteItem[],
  totalMicroUsdc: number,
  campaigns: CampaignForPricing[],
): Promise<CampaignDiscountResult> {
  let curItems = items;
  let curTotal = totalMicroUsdc;
  let totalDiscount = 0;
  const appliedCampaignIds: string[] = [];

  for (const campaign of campaigns) {
    const evaluableRules = campaign.rules.filter((r) => r.ruleType === "percent_off" || r.ruleType === "fixed_off");
    if (evaluableRules.length === 0) continue;

    let campaignApplied = false;
    for (const rule of evaluableRules) {
      let discount =
        rule.discountType === "percent" ? applyBps(curTotal, Number(rule.discountValue)) : Number(rule.discountValue);
      if (rule.maximumDiscountMicroUsdc != null) {
        discount = Math.min(discount, Number(rule.maximumDiscountMicroUsdc));
      }
      if (discount <= 0) continue;

      const result = await spreadDiscount(store, merchant, curItems, curTotal, discount);
      if (result.discountMicroUsdc > 0) {
        curItems = result.newItems;
        curTotal = result.newTotal;
        totalDiscount += result.discountMicroUsdc;
        campaignApplied = true;
      }
    }

    if (campaignApplied) {
      appliedCampaignIds.push(campaign.id);
      if (campaign.stackPolicy === "exclusive") break;
    }
  }

  return { items: curItems, totalMicroUsdc: curTotal, discountMicroUsdc: totalDiscount, appliedCampaignIds };
}

/**
 * DB-fetching wrapper around `applyCampaignRules` — resolves the merchant's
 * Postgres org id, loads its currently-active campaigns, and delegates. A
 * thin pass-through (matches this codebase's convention of only
 * integration-testing DB-querying repo functions against a live Postgres,
 * per AGENTS.md's test rules — the risk lives in `applyCampaignRules`
 * above, not here). No-ops (returns the input unchanged) in mock/SQLite mode
 * — self-service merchants and their campaigns are Postgres-only, same guard
 * as `pricingPolicy.ts`'s `logDecision`.
 */
export async function applyCampaignDiscount(
  db: Db | undefined,
  store: MerchantStore,
  merchant: MerchantRow,
  items: QuoteItem[],
  totalMicroUsdc: number,
): Promise<CampaignDiscountResult> {
  const noDiscount: CampaignDiscountResult = { items, totalMicroUsdc, discountMicroUsdc: 0, appliedCampaignIds: [] };
  if (!db) return noDiscount;
  const orgId = await store.getOrgId(merchant.merchant_id);
  if (!orgId) return noDiscount;

  const campaigns = await listActiveCampaignsForMerchant(db, orgId, new Date());
  if (campaigns.length === 0) return noDiscount;

  return applyCampaignRules(store, merchant, items, totalMicroUsdc, campaigns);
}

import { createHash } from "node:crypto";
import { insertPricingDecision, type Db } from "@merchantmesh/db";
import { QUOTE_VALIDITY_SECONDS, type MerchantDecision, type QuoteItem } from "@merchantmesh/shared";
import { applyBoundedDiscount } from "./quotes.js";
import type { DiscountDecisionProvider } from "./discountProvider.js";
import type { MerchantStore } from "./store.js";
import type { MerchantRow } from "./db.js";
import { nowSec } from "./db.js";

const PROMPT_VERSION = "discount-v1";
const POLICY_VERSION = "pricing-v1";

// ---------------------------------------------------------------------------
// Basic per-agent rate limit — in-memory fixed window, no new Redis
// dependency for something this small (apps/merchant-agents has none today).
// Not a reputation system: just stops one misbehaving/expensive agent from
// hammering the LLM path. Over the limit ⇒ skip straight to the deterministic
// fallback rather than erroring the request.
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const rateLimitState = new Map<number, { windowStart: number; count: number }>();

function isRateLimited(merchantId: number): boolean {
  const now = Date.now();
  const state = rateLimitState.get(merchantId);
  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(merchantId, { windowStart: now, count: 1 });
    return false;
  }
  state.count += 1;
  return state.count > RATE_LIMIT_MAX_PER_WINDOW;
}

export interface PricingDecisionResult {
  items: QuoteItem[];
  totalMicroUsdc: number;
  discountMicroUsdc: number;
}

function inputHashFor(merchant: MerchantRow, items: QuoteItem[], totalMicroUsdc: number): string {
  return createHash("sha256").update(JSON.stringify({ merchantId: merchant.merchant_id, items, totalMicroUsdc })).digest("hex");
}

async function logDecision(
  db: Db | undefined,
  store: MerchantStore,
  merchant: MerchantRow,
  requestItems: QuoteItem[],
  baseTotalMicroUsdc: number,
  result: PricingDecisionResult,
  fallbackUsed: boolean,
  fallbackReason?: string,
  llmDecision?: MerchantDecision,
): Promise<void> {
  if (!db) return; // mock/SQLite mode — no Postgres org to log against
  const orgId = await store.getOrgId(merchant.merchant_id);
  if (!orgId) return;
  await insertPricingDecision(db, {
    merchantId: orgId,
    inputHash: inputHashFor(merchant, requestItems, baseTotalMicroUsdc),
    model: llmDecision ? "agy" : "mock",
    promptVersion: PROMPT_VERSION,
    policyVersion: POLICY_VERSION,
    llmOutputJson: llmDecision,
    appliedRulesJson: [{ rule: "max_discount_bps_cap", value: merchant.max_discount_bps }, { rule: "min_price_floor" }],
    baseTotalMicroUsdc: BigInt(baseTotalMicroUsdc),
    discountMicroUsdc: BigInt(result.discountMicroUsdc),
    finalTotalMicroUsdc: BigInt(result.totalMicroUsdc),
    validUntil: nowSec() + QUOTE_VALIDITY_SECONDS,
    fallbackUsed,
    fallbackReason,
  });
}

function isTimeoutError(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * The single call site that turns a DiscountDecisionProvider's suggestion
 * into an actual price change — see AGENTS.md's "Ödeme Akışı" section. On any
 * failure (timeout, rate limit, invalid output, provider error) this falls
 * back to the plain undiscounted quote rather than erroring the request,
 * since a merchant quote must always be answerable; the fallback is always
 * logged so it's visible in `GET /merchant-agents/:id/decisions`.
 */
export async function decideAndApplyDiscount(
  db: Db | undefined,
  store: MerchantStore,
  provider: DiscountDecisionProvider,
  merchant: MerchantRow,
  items: QuoteItem[],
  totalMicroUsdc: number,
  opts: { requestedDiscountBps?: number; productMaxDiscountBps?: number } = {},
): Promise<PricingDecisionResult> {
  const noDiscount: PricingDecisionResult = { items, totalMicroUsdc, discountMicroUsdc: 0 };

  if (isRateLimited(merchant.merchant_id)) {
    await logDecision(db, store, merchant, items, totalMicroUsdc, noDiscount, true, "rate_limited");
    return noDiscount;
  }

  let decision: MerchantDecision;
  try {
    decision = await provider.decide({ merchant, items, totalMicroUsdc, requestedDiscountBps: opts.requestedDiscountBps });
  } catch (err) {
    const fallbackReason = isTimeoutError(err) ? "timeout" : "provider_error";
    await logDecision(db, store, merchant, items, totalMicroUsdc, noDiscount, true, fallbackReason);
    return noDiscount;
  }

  const applied = await applyBoundedDiscount(store, merchant, items, totalMicroUsdc, decision.proposedDiscountBps, opts.productMaxDiscountBps);
  const result: PricingDecisionResult = { items: applied.newItems, totalMicroUsdc: applied.newTotal, discountMicroUsdc: applied.discountMicroUsdc };
  await logDecision(db, store, merchant, items, totalMicroUsdc, result, false, undefined, decision);
  return result;
}

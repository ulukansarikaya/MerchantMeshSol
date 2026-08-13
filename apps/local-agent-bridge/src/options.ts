import {
  getSku,
  type MerchantPublic,
  type PlanItem,
  type QuoteItem,
  type ShoppingOption,
  type OptionShop,
  type SignedQuote,
} from "@merchantmesh/shared";

export interface CandidateQuote {
  merchant: MerchantPublic;
  quote: SignedQuote;
}

interface Assignment {
  item: PlanItem;
  candidate: CandidateQuote;
  unitPrice: number;
}

function findQuoteItem(quote: SignedQuote, sku: string): QuoteItem | undefined {
  return quote.items.find((i) => i.sku === sku);
}

/** Merchants able to supply an item at the planned quantity, per their signed quote. */
function candidatesFor(item: PlanItem, quotes: CandidateQuote[]): { candidate: CandidateQuote; unitPrice: number }[] {
  const out: { candidate: CandidateQuote; unitPrice: number }[] = [];
  for (const candidate of quotes) {
    const qi = findQuoteItem(candidate.quote, item.sku);
    if (qi && qi.qty >= item.qty) out.push({ candidate, unitPrice: qi.unitPriceMicroUsdc });
  }
  return out;
}

function buildShops(assignments: Assignment[]): OptionShop[] {
  const byMerchant = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const key = a.candidate.merchant.slug;
    byMerchant.set(key, [...(byMerchant.get(key) ?? []), a]);
  }
  const shops: OptionShop[] = [];
  for (const group of byMerchant.values()) {
    const { merchant, quote } = group[0]!.candidate;
    const items: QuoteItem[] = group.map((a) => ({
      sku: a.item.sku,
      qty: a.item.qty,
      unitPriceMicroUsdc: a.unitPrice,
    }));
    shops.push({
      merchantId: merchant.merchantId,
      merchantSlug: merchant.slug,
      merchantName: merchant.name,
      quoteId: quote.quoteId,
      items,
      subtotalMicroUsdc: items.reduce((s, i) => s + i.unitPriceMicroUsdc * i.qty, 0),
      distanceM: merchant.distanceM ?? 0,
      essential: group.some((a) => a.item.essential),
    });
  }
  // Essential shops first, then nearest — same order the funding saga uses.
  return shops.sort((a, b) => Number(b.essential) - Number(a.essential) || a.distanceM - b.distanceM);
}

function toOption(
  kind: ShoppingOption["kind"],
  label: string,
  note: string,
  shops: OptionShop[],
  qualityBySlug: Map<string, number>,
): ShoppingOption {
  const total = shops.reduce((s, shop) => s + shop.subtotalMicroUsdc, 0);
  return {
    kind,
    label,
    shops,
    totalMicroUsdc: total,
    totalWalkM: shops.reduce((s, shop) => s + shop.distanceM, 0),
    stops: shops.length,
    avgQuality: Number(
      (shops.reduce((s, shop) => s + (qualityBySlug.get(shop.merchantSlug) ?? 0), 0) / shops.length).toFixed(1),
    ),
    note,
  };
}

export interface OptionsResult {
  options: ShoppingOption[];
  unfulfillable: string[]; // skus no merchant could quote
}

/**
 * Deterministic options builder — cheapest / best-quality per item, plus a
 * pickup-optimized greedy set cover (fewest stops) included only if its route
 * differs from the other two.
 */
export function buildOptions(planItems: PlanItem[], quotes: CandidateQuote[]): OptionsResult {
  const qualityBySlug = new Map(quotes.map((q) => [q.merchant.slug, q.merchant.qualityScore]));

  const fulfillable: PlanItem[] = [];
  const unfulfillable: string[] = [];
  for (const item of planItems) {
    if (candidatesFor(item, quotes).length > 0) fulfillable.push(item);
    else unfulfillable.push(item.sku);
  }
  if (fulfillable.length === 0) return { options: [], unfulfillable };

  // --- cheapest: per item, lowest unit price; tie → nearest merchant
  const cheapestAssign: Assignment[] = fulfillable.map((item) => {
    const cands = candidatesFor(item, quotes).sort(
      (a, b) => a.unitPrice - b.unitPrice || (a.candidate.merchant.distanceM ?? 0) - (b.candidate.merchant.distanceM ?? 0),
    );
    return { item, candidate: cands[0]!.candidate, unitPrice: cands[0]!.unitPrice };
  });

  // --- best quality: per item, highest merchant quality; tie → cheaper
  const qualityAssign: Assignment[] = fulfillable.map((item) => {
    const cands = candidatesFor(item, quotes).sort(
      (a, b) => b.candidate.merchant.qualityScore - a.candidate.merchant.qualityScore || a.unitPrice - b.unitPrice,
    );
    return { item, candidate: cands[0]!.candidate, unitPrice: cands[0]!.unitPrice };
  });

  // --- pickup optimized: greedy set cover → fewest stops, tie → nearest
  const pickupAssign: Assignment[] = [];
  {
    const remaining = new Set(fulfillable.map((i) => i.sku));
    const chosen: CandidateQuote[] = [];
    while (remaining.size > 0) {
      let best: { candidate: CandidateQuote; covers: PlanItem[] } | undefined;
      for (const candidate of quotes) {
        const covers = fulfillable.filter(
          (i) => remaining.has(i.sku) && (findQuoteItem(candidate.quote, i.sku)?.qty ?? 0) >= i.qty,
        );
        if (
          covers.length > 0 &&
          (!best ||
            covers.length > best.covers.length ||
            (covers.length === best.covers.length &&
              (candidate.merchant.distanceM ?? 0) < (best.candidate.merchant.distanceM ?? 0)))
        ) {
          best = { candidate, covers };
        }
      }
      if (!best) break;
      chosen.push(best.candidate);
      for (const item of best.covers) {
        remaining.delete(item.sku);
        pickupAssign.push({
          item,
          candidate: best.candidate,
          unitPrice: findQuoteItem(best.candidate.quote, item.sku)!.unitPriceMicroUsdc,
        });
      }
    }
  }

  const cheapest = toOption(
    "cheapest",
    "Lowest Price",
    "The lowest available unit price for each item.",
    buildShops(cheapestAssign),
    qualityBySlug,
  );
  const bestQuality = toOption(
    "best_quality",
    "Best Quality",
    "The highest-rated merchant for each item.",
    buildShops(qualityAssign),
    qualityBySlug,
  );
  const pickupOptimized = toOption(
    "pickup_optimized",
    "Optimized Pickup Route",
    "The complete list with the fewest stops, shown when the route differs.",
    buildShops(pickupAssign),
    qualityBySlug,
  );

  const routeOf = (o: ShoppingOption) => o.shops.map((s) => s.merchantSlug).sort().join(",");
  const options: ShoppingOption[] = [cheapest];
  if (routeOf(bestQuality) !== routeOf(cheapest) || bestQuality.totalMicroUsdc !== cheapest.totalMicroUsdc) {
    options.push(bestQuality);
  }
  if (routeOf(pickupOptimized) !== routeOf(cheapest) && routeOf(pickupOptimized) !== routeOf(bestQuality)) {
    options.push(pickupOptimized);
  }
  return { options, unfulfillable };
}

import { randomUUID } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import {
  QUOTE_VALIDITY_SECONDS,
  applyBps,
  hexToBytes,
  signQuote,
  type Quote,
  type QuoteItem,
  type SignedQuote,
} from "@merchantmesh/shared";
import { nowSec, type InventoryRow, type MerchantDb, type MerchantRow } from "./db.js";
import type { MerchantStore } from "./store.js";

export class QuoteError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function nextNonce(db: MerchantDb, merchantId: number): number {
  const row = db.prepare("SELECT next_nonce FROM nonces WHERE merchant_id = ?").get(merchantId) as
    | { next_nonce: number }
    | undefined;
  const nonce = row?.next_nonce ?? 1;
  db.prepare("INSERT OR REPLACE INTO nonces (merchant_id, next_nonce) VALUES (?, ?)").run(merchantId, nonce + 1);
  return nonce;
}

export async function getInventoryItem(store: MerchantStore, merchantId: number, sku: string): Promise<InventoryRow | undefined> {
  return store.getInventoryItem(merchantId, sku);
}

/** Base (undiscounted) items + total straight from the inventory table — the piece Faz 3's pricingPolicy.ts needs before it can propose a discount on top. */
export async function buildQuoteItems(
  store: MerchantStore,
  merchant: MerchantRow,
  requestedItems: { sku: string; qty: number }[],
): Promise<{ items: QuoteItem[]; total: number }> {
  const items: QuoteItem[] = [];
  for (const req of requestedItems) {
    const inv = await getInventoryItem(store, merchant.merchant_id, req.sku);
    if (!inv) throw new QuoteError("sku_not_stocked", `${merchant.name} does not stock ${req.sku}`);
    if (inv.stock_qty < req.qty) {
      throw new QuoteError("insufficient_stock", `${merchant.name} has ${inv.stock_qty}x ${req.sku}, requested ${req.qty}`);
    }
    items.push({ sku: req.sku as QuoteItem["sku"], qty: req.qty, unitPriceMicroUsdc: inv.price_micro });
  }
  const total = items.reduce((sum, i) => sum + i.unitPriceMicroUsdc * i.qty, 0);
  return { items, total };
}

/**
 * Deterministic pricing straight from the inventory table — the LLM never
 * touches these numbers directly (Faz 3's discount, if any, is already baked
 * into `overrides` by the time it reaches here — see pricingPolicy.ts).
 * Price invariant: unit price ≥ minPriceMicroUsdc.
 */
export async function createQuote(
  db: MerchantDb,
  store: MerchantStore,
  merchant: MerchantRow,
  requestedItems: { sku: string; qty: number }[],
  taskId: string | undefined,
  overrides?: { totalMicroUsdc: number; items: QuoteItem[]; supersedes?: string },
): Promise<SignedQuote> {
  let items: QuoteItem[];
  let total: number;

  if (overrides) {
    items = overrides.items;
    total = overrides.totalMicroUsdc;
  } else {
    ({ items, total } = await buildQuoteItems(store, merchant, requestedItems));
  }

  // Hard invariant: never quote below the merchant's minimum.
  const minTotal = await minTotalFor(store, merchant.merchant_id, items);
  if (total < minTotal) throw new QuoteError("below_min_price", "Quote total below merchant minimum");

  const quote: Quote = {
    quoteId: `q_${randomUUID()}`,
    merchantId: merchant.merchant_id,
    merchantWallet: merchant.wallet,
    items,
    totalMicroUsdc: total,
    validUntil: nowSec() + QUOTE_VALIDITY_SECONDS,
    nonce: nextNonce(db, merchant.merchant_id),
  };
  const signer = await createKeyPairSignerFromPrivateKeyBytes(hexToBytes(merchant.signer_key));
  const signed = await signQuote(signer, quote);

  if (overrides?.supersedes) {
    db.prepare("UPDATE quotes SET status = 'superseded' WHERE quote_id = ?").run(overrides.supersedes);
  }
  db.prepare(
    `INSERT INTO quotes (quote_id, merchant_id, items_json, total_micro, valid_until, nonce, signature, status, supersedes, task_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(
    signed.quoteId, signed.merchantId, JSON.stringify(signed.items), signed.totalMicroUsdc,
    signed.validUntil, signed.nonce, signed.signature, overrides?.supersedes ?? null, taskId ?? null, nowSec(),
  );
  return signed;
}

export interface QuoteRow {
  quote_id: string;
  merchant_id: number;
  items_json: string;
  total_micro: number;
  valid_until: number;
  nonce: number;
  signature: string;
  status: string;
  supersedes: string | null;
  task_id: string | null;
  created_at: number;
}

export function loadQuote(db: MerchantDb, quoteId: string): QuoteRow | undefined {
  return db.prepare("SELECT * FROM quotes WHERE quote_id = ?").get(quoteId) as QuoteRow | undefined;
}

export function rowToSignedQuote(row: QuoteRow, merchantWallet: string): SignedQuote {
  return {
    quoteId: row.quote_id,
    merchantId: row.merchant_id,
    merchantWallet,
    items: JSON.parse(row.items_json),
    totalMicroUsdc: row.total_micro,
    validUntil: row.valid_until,
    nonce: row.nonce,
    signature: row.signature,
  };
}

/** A quote is orderable only while active, unexpired and not superseded. */
export function assertQuoteUsable(row: QuoteRow): void {
  if (row.status === "superseded") throw new QuoteError("quote_superseded", "Quote was superseded by a newer signed quote");
  if (row.status === "consumed") throw new QuoteError("quote_consumed", "Quote already used for an order");
  if (row.status === "expired" || row.valid_until <= nowSec()) {
    throw new QuoteError("quote_expired", "Quote validUntil has passed");
  }
}

export async function minTotalFor(store: MerchantStore, merchantId: number, items: QuoteItem[]): Promise<number> {
  let minTotal = 0;
  for (const item of items) {
    const inv = await getInventoryItem(store, merchantId, item.sku);
    if (!inv) throw new QuoteError("sku_not_stocked", `SKU ${item.sku} not stocked`);
    minTotal += inv.min_price_micro * item.qty;
  }
  return minTotal;
}

export interface BoundedDiscountResult {
  newItems: QuoteItem[];
  newTotal: number;
  discountMicroUsdc: number;
  appliedBps: number;
}

export interface SpreadDiscountResult {
  newItems: QuoteItem[];
  newTotal: number;
  discountMicroUsdc: number;
}

/**
 * Spreads a target `discountMicroUsdc` proportionally across line items, each
 * floored at its own min price — the aggregate floor is `minTotalFor(items)`,
 * so the actual applied discount may be less than requested if it would dip
 * below that. This is the ONLY place a discount is ever actually applied to
 * unit prices — see AGENTS.md's "Ödeme Akışı" section. Shared by
 * `applyBoundedDiscount` (bps-based, negotiation/LLM) and
 * `campaignPricing.ts`'s deterministic campaign discounts (already a flat
 * micro-USDC amount, not a bps — campaigns aren't capped by
 * `merchant.max_discount_bps`, that cap is specifically the negotiation
 * ceiling).
 */
export async function spreadDiscount(
  store: MerchantStore,
  merchant: MerchantRow,
  items: QuoteItem[],
  totalMicroUsdc: number,
  discountMicroUsdc: number,
): Promise<SpreadDiscountResult> {
  const minTotal = await minTotalFor(store, merchant.merchant_id, items);
  const target = Math.max(minTotal, totalMicroUsdc - Math.max(0, discountMicroUsdc));
  const discount = totalMicroUsdc - target;

  const newItems = [];
  for (const item of items) {
    const inv = (await getInventoryItem(store, merchant.merchant_id, item.sku))!;
    const lineTotal = item.unitPriceMicroUsdc * item.qty;
    const share = Math.min(
      Math.floor((discount * lineTotal) / totalMicroUsdc / item.qty),
      item.unitPriceMicroUsdc - inv.min_price_micro,
    );
    newItems.push({ ...item, unitPriceMicroUsdc: item.unitPriceMicroUsdc - share });
  }
  const newTotal = newItems.reduce((s, i) => s + i.unitPriceMicroUsdc * i.qty, 0);
  return { newItems, newTotal, discountMicroUsdc: totalMicroUsdc - newTotal };
}

/**
 * Core deterministic clamp-and-spread: caps `discountBps` at the merchant's
 * (and optionally a per-SKU) max, converts to a flat micro-USDC amount, then
 * delegates to `spreadDiscount`. Used by both `counterOffer` (negotiation,
 * which halves the request itself before calling this) and Faz 3's
 * `pricingPolicy.ts` (which passes an LLM-proposed bps straight through — no
 * halving, since the proposal already represents the intended offer, not an
 * opening haggle).
 */
export async function applyBoundedDiscount(
  store: MerchantStore,
  merchant: MerchantRow,
  items: QuoteItem[],
  totalMicroUsdc: number,
  discountBps: number,
  productMaxDiscountBps?: number,
): Promise<BoundedDiscountResult> {
  const cap = Math.min(merchant.max_discount_bps, productMaxDiscountBps ?? merchant.max_discount_bps);
  const appliedBps = Math.floor(Math.min(Math.max(discountBps, 0), cap));
  const result = await spreadDiscount(store, merchant, items, totalMicroUsdc, applyBps(totalMicroUsdc, appliedBps));
  return { ...result, appliedBps };
}

/**
 * Deterministic counter-offer: the merchant concedes half of the requested
 * discount, capped at maxDiscountBps, floored at min prices.
 */
export async function counterOffer(
  store: MerchantStore,
  merchant: MerchantRow,
  quoteRow: QuoteRow,
  requestedDiscountBps: number,
): Promise<{ newItems: QuoteItem[]; newTotal: number; discountMicroUsdc: number; counterBps: number }> {
  const items: QuoteItem[] = JSON.parse(quoteRow.items_json);
  const halved = Math.floor(Math.min(requestedDiscountBps, merchant.max_discount_bps) / 2);
  const result = await applyBoundedDiscount(store, merchant, items, quoteRow.total_micro, halved);
  return { newItems: result.newItems, newTotal: result.newTotal, discountMicroUsdc: result.discountMicroUsdc, counterBps: result.appliedBps };
}

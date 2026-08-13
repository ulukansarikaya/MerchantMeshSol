import type { Address } from "@solana/kit";
import { DEV_KEY_SEEDS, devAddress } from "./solanaKeys.js";
import type { MerchantCategory } from "./skus.js";
import type { VerificationFlags } from "./schemas.js";
import { CANONICAL_SKUS } from "./skus.js";

export interface SeedInventoryItem {
  sku: string;
  priceMicroUsdc: number;
  minPriceMicroUsdc: number;
  stockQty: number;
}

export interface SeedMerchant {
  merchantId: number;
  slug: string;
  name: string;
  category: MerchantCategory;
  lat: number;
  lng: number;
  wallet: Address;
  signerKeyEnv: string; // env var that overrides the dev signer key in real mode
  devSignerKey: Uint8Array;
  qualityScore: number;
  negotiation: { enabled: boolean; maxDiscountBps: number };
  reservation: { enabled: boolean; ttlSeconds: number };
  pickup: boolean;
  openingHours: string;
  verification: VerificationFlags; // seeded flags in mock mode; real values via an identity registry in chain mode, if one is ever wired up
  agentId: number;
  inventory: SeedInventoryItem[];
}

const FULL_STOCK_QTY = 100;
const BASE_PRICE_MICRO: Record<string, number> = {
  "kiyma-dana": 4_200_000, "kusbasi-dana": 4_900_000, "tavuk-but": 2_600_000,
  domates: 850_000, sogan: 480_000, maydanoz: 280_000, "biber-carliston": 650_000,
  salatalik: 520_000, ekmek: 450_000, lavas: 380_000, ayran: 620_000,
  yogurt: 1_150_000, yumurta: 1_900_000,
};

function fullInventory(existing: readonly SeedInventoryItem[], priceBps: number): SeedInventoryItem[] {
  const current = new Map(existing.map((item) => [item.sku, item]));
  return CANONICAL_SKUS.map(({ sku }) => {
    const item = current.get(sku);
    if (item) return { ...item };
    const price = Math.round(((BASE_PRICE_MICRO[sku] ?? 1_000_000) * priceBps) / 10_000 / 10_000) * 10_000;
    return { sku, priceMicroUsdc: price, minPriceMicroUsdc: Math.floor(price * 0.95), stockQty: FULL_STOCK_QTY };
  });
}

/**
 * Fixed merchant seed around the Kızılay home point (39.9208, 32.8541).
 * Coordinate offsets are chosen so Haversine distances land on the spec'd
 * values: Ali ~172m, Can ~305m, Zeynep ~342m, Mini ~378m, Cem ~387m.
 *
 * Both butchers stock kıyma at different price/quality on purpose:
 * Can is cheaper (3.90), Ali is better (9.1 quality, 4.50) — the
 * quality-score micro-action has a visible reason to exist.
 */
export const SEED_MERCHANTS: readonly SeedMerchant[] = [
  {
    merchantId: 1,
    slug: "ali-kasap",
    name: "Oak Street Foods",
    category: "butcher",
    lat: 39.922345,
    lng: 32.8541,
    wallet: devAddress(0),
    signerKeyEnv: "MERCHANT_ALI_KASAP_PRIVATE_KEY",
    devSignerKey: DEV_KEY_SEEDS[0]!,
    qualityScore: 9.1,
    negotiation: { enabled: true, maxDiscountBps: 600 },
    reservation: { enabled: false, ttlSeconds: 0 },
    pickup: true,
    openingHours: "08:00-20:00",
    verification: { identity: true, attestation: true, stake: true },
    agentId: 101,
    inventory: fullInventory([
      { sku: "kiyma-dana", priceMicroUsdc: 4_500_000, minPriceMicroUsdc: 4_200_000, stockQty: 20 },
      { sku: "kusbasi-dana", priceMicroUsdc: 5_200_000, minPriceMicroUsdc: 4_900_000, stockQty: 15 },
      { sku: "tavuk-but", priceMicroUsdc: 2_800_000, minPriceMicroUsdc: 2_600_000, stockQty: 18 },
    ], 10_000),
  },
  {
    merchantId: 2,
    slug: "can-kasap",
    name: "Riverside Pantry",
    category: "butcher",
    lat: 39.918059,
    lng: 32.8541,
    wallet: devAddress(1),
    signerKeyEnv: "MERCHANT_CAN_KASAP_PRIVATE_KEY",
    devSignerKey: DEV_KEY_SEEDS[1]!,
    qualityScore: 7.2,
    negotiation: { enabled: true, maxDiscountBps: 400 },
    reservation: { enabled: false, ttlSeconds: 0 },
    pickup: true,
    openingHours: "08:30-20:30",
    verification: { identity: true, attestation: false, stake: true },
    agentId: 102,
    inventory: fullInventory([
      { sku: "kiyma-dana", priceMicroUsdc: 3_900_000, minPriceMicroUsdc: 3_700_000, stockQty: 25 },
      { sku: "kusbasi-dana", priceMicroUsdc: 4_700_000, minPriceMicroUsdc: 4_400_000, stockQty: 10 },
      { sku: "tavuk-but", priceMicroUsdc: 2_500_000, minPriceMicroUsdc: 2_300_000, stockQty: 20 },
    ], 9_400),
  },
  {
    merchantId: 3,
    slug: "zeynep-manav",
    name: "Green Basket",
    category: "greengrocer",
    lat: 39.9208,
    lng: 32.858106,
    wallet: devAddress(2),
    signerKeyEnv: "MERCHANT_ZEYNEP_MANAV_PRIVATE_KEY",
    devSignerKey: DEV_KEY_SEEDS[2]!,
    qualityScore: 8.4,
    negotiation: { enabled: true, maxDiscountBps: 800 },
    reservation: { enabled: false, ttlSeconds: 0 },
    pickup: true,
    openingHours: "07:30-19:30",
    verification: { identity: true, attestation: true, stake: false },
    agentId: 103,
    inventory: fullInventory([
      { sku: "domates", priceMicroUsdc: 900_000, minPriceMicroUsdc: 800_000, stockQty: 50 },
      { sku: "sogan", priceMicroUsdc: 500_000, minPriceMicroUsdc: 440_000, stockQty: 60 },
      { sku: "maydanoz", priceMicroUsdc: 300_000, minPriceMicroUsdc: 260_000, stockQty: 40 },
      { sku: "biber-carliston", priceMicroUsdc: 700_000, minPriceMicroUsdc: 620_000, stockQty: 30 },
      { sku: "salatalik", priceMicroUsdc: 550_000, minPriceMicroUsdc: 480_000, stockQty: 35 },
    ], 10_300),
  },
  {
    merchantId: 4,
    slug: "cem-firin",
    name: "Sunrise Provisions",
    category: "bakery",
    lat: 39.924277,
    lng: 32.8541,
    wallet: devAddress(3),
    signerKeyEnv: "MERCHANT_CEM_FIRIN_PRIVATE_KEY",
    devSignerKey: DEV_KEY_SEEDS[3]!,
    qualityScore: 8.8,
    negotiation: { enabled: false, maxDiscountBps: 0 },
    reservation: { enabled: true, ttlSeconds: 600 }, // last-2-loaves demo
    pickup: true,
    openingHours: "06:00-19:00",
    verification: { identity: true, attestation: false, stake: false },
    agentId: 104,
    inventory: fullInventory([
      { sku: "ekmek", priceMicroUsdc: 400_000, minPriceMicroUsdc: 400_000, stockQty: 2 },
      { sku: "lavas", priceMicroUsdc: 350_000, minPriceMicroUsdc: 350_000, stockQty: 10 },
    ], 9_700),
  },
  {
    merchantId: 5,
    slug: "mini-market",
    name: "Central Pantry",
    category: "market",
    lat: 39.9208,
    lng: 32.849674,
    wallet: devAddress(4),
    signerKeyEnv: "MERCHANT_MINI_MARKET_PRIVATE_KEY",
    devSignerKey: DEV_KEY_SEEDS[4]!,
    qualityScore: 6.9,
    negotiation: { enabled: false, maxDiscountBps: 0 },
    reservation: { enabled: false, ttlSeconds: 0 },
    pickup: true,
    openingHours: "08:00-22:00",
    verification: { identity: true, attestation: false, stake: false },
    agentId: 105,
    inventory: fullInventory([
      { sku: "ayran", priceMicroUsdc: 600_000, minPriceMicroUsdc: 600_000, stockQty: 30 },
      { sku: "yogurt", priceMicroUsdc: 1_200_000, minPriceMicroUsdc: 1_200_000, stockQty: 15 },
      { sku: "yumurta", priceMicroUsdc: 2_000_000, minPriceMicroUsdc: 2_000_000, stockQty: 25 },
      // Packaged bread — lets the pickup-optimized option merge bakery+market
      // into one stop (industrial loaf, slightly pricier than Cem's fresh one).
      { sku: "ekmek", priceMicroUsdc: 550_000, minPriceMicroUsdc: 550_000, stockQty: 10 },
    ], 10_800),
  },
] as const;

export function seedMerchantBySlug(slug: string): SeedMerchant {
  const m = SEED_MERCHANTS.find((x) => x.slug === slug);
  if (!m) throw new Error(`Unknown merchant slug: ${slug}`);
  return m;
}

/**
 * Paid endpoint price list (integer micro-USDC). Faz J §3 — `quote-basket`
 * is a new endpoint the orchestrator now calls INSTEAD of `quote` (a strict
 * superset of the same paid call, now also carrying quality/prepTime/
 * reservation-eligibility so the separate `ask`(quality) call is no longer
 * needed in the pipeline). `quote` itself is left in place — still a valid,
 * separately-tested endpoint, just not the one the bridge's own pipeline
 * calls anymore — least-invasive over deleting/rewriting it and its tests.
 * `order` is gone entirely — Faz I's acceptance flow made order creation
 * free; the mock fast-forward path's /order endpoint is unguarded now.
 */
export const ENDPOINT_PRICES_MICRO = {
  ask: 200, //             0.0002 USDC
  inventory: 300, //       0.0003 USDC
  quote: 500, //           0.0005 USDC
  "quote-basket": 500, //  0.0005 USDC — same price as `quote`
  negotiate: 2000, //      0.002  USDC
  reserve: 1000, //        0.001  USDC
} as const;
export type PaidEndpoint = keyof typeof ENDPOINT_PRICES_MICRO;

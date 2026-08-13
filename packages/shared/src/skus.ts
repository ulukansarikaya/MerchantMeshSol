import { z } from "zod";

export const MerchantCategory = z.enum(["butcher", "greengrocer", "bakery", "market"]);
export type MerchantCategory = z.infer<typeof MerchantCategory>;

/**
 * Canonical product list. The LLM may ONLY emit these SKU ids — every plan is
 * validated against this list; prices/stock never come from the model.
 * `essential` is the default essentiality used by the saga (e.g. for köfte,
 * minced beef is essential; ayran is a nice-to-have).
 */
export interface CanonicalSku {
  sku: string;
  nameTr: string;
  nameEn: string;
  category: MerchantCategory;
  unit: string;
  essential: boolean;
}

export const CANONICAL_SKUS: readonly CanonicalSku[] = [
  { sku: "kiyma-dana", nameTr: "Dana Kıyma (500g)", nameEn: "Ground beef (500g)", category: "butcher", unit: "500g paket", essential: true },
  { sku: "kusbasi-dana", nameTr: "Dana Kuşbaşı (500g)", nameEn: "Diced beef (500g)", category: "butcher", unit: "500g paket", essential: true },
  { sku: "tavuk-but", nameTr: "Tavuk But (1kg)", nameEn: "Chicken thigh (1kg)", category: "butcher", unit: "kg", essential: true },
  { sku: "domates", nameTr: "Domates (1kg)", nameEn: "Tomatoes (1kg)", category: "greengrocer", unit: "kg", essential: true },
  { sku: "sogan", nameTr: "Kuru Soğan (1kg)", nameEn: "Onions (1kg)", category: "greengrocer", unit: "kg", essential: true },
  { sku: "maydanoz", nameTr: "Maydanoz (demet)", nameEn: "Parsley (bunch)", category: "greengrocer", unit: "demet", essential: true },
  { sku: "biber-carliston", nameTr: "Çarliston Biber (500g)", nameEn: "Sweet peppers (500g)", category: "greengrocer", unit: "500g", essential: false },
  { sku: "salatalik", nameTr: "Salatalık (1kg)", nameEn: "Cucumbers (1kg)", category: "greengrocer", unit: "kg", essential: false },
  { sku: "ekmek", nameTr: "Ekmek (adet)", nameEn: "Bread loaf", category: "bakery", unit: "adet", essential: true },
  { sku: "lavas", nameTr: "Lavaş (adet)", nameEn: "Lavash flatbread", category: "bakery", unit: "adet", essential: false },
  { sku: "ayran", nameTr: "Ayran (1L)", nameEn: "Ayran (1L)", category: "market", unit: "1L şişe", essential: false },
  { sku: "yogurt", nameTr: "Yoğurt (1kg)", nameEn: "Yogurt (1kg)", category: "market", unit: "kg", essential: false },
  { sku: "yumurta", nameTr: "Yumurta (10'lu)", nameEn: "Eggs (10-pack)", category: "market", unit: "10'lu koli", essential: false },
] as const;

export const SKU_IDS = CANONICAL_SKUS.map((s) => s.sku) as [string, ...string[]];

const bySku = new Map(CANONICAL_SKUS.map((s) => [s.sku, s]));

export function getSku(sku: string): CanonicalSku {
  const found = bySku.get(sku);
  if (!found) throw new Error(`Unknown SKU: ${sku}`);
  return found;
}

export function isCanonicalSku(sku: string): boolean {
  return bySku.has(sku);
}

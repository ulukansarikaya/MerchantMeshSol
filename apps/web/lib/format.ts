/** micro-USDC (integer, 6 decimals) → display string. Mirrors @merchantmesh/shared. */
export function microToUsdc(micro: number): string {
  const whole = Math.floor(micro / 1_000_000);
  const frac = micro % 1_000_000;
  if (frac === 0) return `${whole}.00`;
  let fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, "0");
  return `${whole}.${fracStr}`;
}

export function usdc(micro: number): string {
  return `${microToUsdc(micro)} USDC`;
}

export function shortTx(tx?: string | null): string {
  if (!tx) return "—";
  return tx.length > 20 ? `${tx.slice(0, 12)}…${tx.slice(-6)}` : tx;
}

export const SKU_LABELS: Record<string, string> = {
  "kiyma-dana": "Ground Beef (500g)",
  "kusbasi-dana": "Diced Beef (500g)",
  "tavuk-but": "Chicken Thighs (1kg)",
  domates: "Tomatoes (1kg)",
  sogan: "Onions (1kg)",
  maydanoz: "Parsley (bunch)",
  "biber-carliston": "Green Peppers",
  salatalik: "Cucumbers (1kg)",
  ekmek: "Bread",
  lavas: "Flatbread",
  ayran: "Yogurt Drink (1L)",
  yogurt: "Yogurt (1kg)",
  yumurta: "Eggs (10-pack)",
};

export function skuLabel(sku: string): string {
  return SKU_LABELS[sku] ?? sku;
}

export const STATE_LABELS: Record<string, string> = {
  quoted: "Quoted",
  user_selected: "Selected",
  merchant_pending: "Awaiting Merchant Approval",
  merchant_confirmed: "Merchant Confirmed",
  merchant_rejected: "Merchant Rejected",
  awaiting_funding: "Awaiting Funding",
  paid_in_escrow: "Funded in Escrow",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Delivered",
  expired: "Expired",
  refunded: "Refunded",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

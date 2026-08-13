/**
 * All prices in MerchantMesh are USDC-native, stored as integer micro-USDC
 * (6 decimals). No floats in money math, no fiat anywhere in logic.
 */
export const USDC_DECIMALS = 6;
export const MICRO_PER_USDC = 1_000_000;

/** Parse a decimal USDC string ("4.50") into integer micro-USDC (4500000). */
export function usdcToMicro(value: string): number {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (!m) throw new Error(`Invalid USDC amount: ${value}`);
  const whole = Number(m[1]);
  const frac = (m[2] ?? "").padEnd(6, "0");
  const micro = whole * MICRO_PER_USDC + Number(frac);
  if (!Number.isSafeInteger(micro)) throw new Error(`USDC amount out of range: ${value}`);
  return micro;
}

/** Format integer micro-USDC as a decimal USDC string. 4500000 → "4.50" */
export function microToUsdc(micro: number): string {
  assertMicro(micro);
  const whole = Math.floor(micro / MICRO_PER_USDC);
  const frac = micro % MICRO_PER_USDC;
  if (frac === 0) return `${whole}.00`;
  let fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, "0");
  return `${whole}.${fracStr}`;
}

export function assertMicro(micro: number): void {
  if (!Number.isSafeInteger(micro) || micro < 0) {
    throw new Error(`Invalid micro-USDC amount: ${micro}`);
  }
}

/** Apply basis points to a micro amount, rounding down (deterministic). */
export function applyBps(micro: number, bps: number): number {
  assertMicro(micro);
  return Math.floor((micro * bps) / 10_000);
}

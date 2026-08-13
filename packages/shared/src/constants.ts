// Browser-safe: reads `process.env` defensively (no node:fs), so this file
// can stay in the main barrel (see merchants.ts for the same pattern).
function envIntOr(name: string, def: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (!raw) return def;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : def;
}

// ---------------------------------------------------------------------------
// Order state machine timing (Faz 0 §1) — seconds, env-overridable.
// ---------------------------------------------------------------------------
export const MERCHANT_ACCEPT_WINDOW_SEC = envIntOr("MERCHANT_ACCEPT_WINDOW_SEC", 120);
export const FUNDING_WINDOW_SEC = envIntOr("FUNDING_WINDOW_SEC", 600);
export const PREP_DEADLINE_SEC = envIntOr("PREP_DEADLINE_SEC", 3600);
export const RESERVATION_TTL_SEC = envIntOr("RESERVATION_TTL_SEC", 600);

// ---------------------------------------------------------------------------
// Session wallet limits (Faz 0 §6) — testnet pilot defaults, env-overridable.
// ---------------------------------------------------------------------------
export const SESSION_WALLET_MAX_BALANCE_MICRO = envIntOr("SESSION_WALLET_MAX_BALANCE_MICRO", 1_000_000);
export const SESSION_WALLET_PER_TASK_MICRO = envIntOr("SESSION_WALLET_PER_TASK_MICRO", 10_000);
export const SESSION_WALLET_PER_DAY_MICRO = envIntOr("SESSION_WALLET_PER_DAY_MICRO", 1_000_000);
export const MAX_PAYMENTS_PER_TASK = envIntOr("MAX_PAYMENTS_PER_TASK", 8);
export const MAX_PAID_MERCHANTS = envIntOr("MAX_PAID_MERCHANTS", 3);

/**
 * plans/faz-0.md §6 — the session-wallet signing layer must refuse to sign
 * against Solana mainnet-beta while TESTNET_ONLY=true (the default).
 * Call this immediately before any session-wallet transfer.
 */
export function assertTestnetOnly(cluster: string, env: Record<string, string | undefined> = process.env): void {
  const testnetOnly = (env.TESTNET_ONLY ?? "true") !== "false";
  if (testnetOnly && cluster === "mainnet-beta") {
    throw new Error(
      `TESTNET_ONLY is set but cluster is mainnet-beta — refusing to sign a session-wallet transaction.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Chain (Faz 0 §3, ported to Solana) — real values wired once the programs in
// /solana are deployed to a live cluster. Both merchant-agents and
// local-agent-bridge must read the SAME SOLANA_CLUSTER (see solanaConfig.ts)
// or quote signatures/verification will disagree about which wallet a
// merchant is signing as.
// ---------------------------------------------------------------------------
export const DEFAULT_SOLANA_CLUSTER = (typeof process !== "undefined" ? process.env?.SOLANA_CLUSTER : undefined) ?? "devnet";

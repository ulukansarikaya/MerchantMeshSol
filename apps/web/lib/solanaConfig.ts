// Client-side Solana config. `@merchantmesh/shared`'s readSolanaEnvConfig()
// reads non-prefixed process.env.SOLANA_* vars which Next.js does NOT inline
// into the browser bundle — only NEXT_PUBLIC_* vars survive there — so the
// web app keeps its own small NEXT_PUBLIC_SOLANA_* mirror instead (see
// .env.example). Keep cluster/RPC in sync with SOLANA_* by hand.
//
// Program ids are NOT env-configurable — unlike an EVM contract address, a
// Solana program's id is fixed at build time (baked into `declare_id!` and
// the IDL in /solana), so the web app imports them straight from
// @merchantmesh/shared instead of mirroring them here.
export const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet";

// Routed through this app's own /api/rpc handler rather than straight at a
// provider: the real endpoint carries an API key that must not ship in the
// browser bundle, and the keyless public devnet endpoint rate-limits (429)
// when a single approval funds several escrows back to back. Override with
// NEXT_PUBLIC_SOLANA_RPC_URL only if you have a keyless endpoint that can
// take the load.
//
// Absolute, not a bare "/api/rpc": both wallet-adapter's ConnectionProvider
// and @solana/kit reject a relative endpoint, so the origin is filled in
// here. Only the browser actually drives those clients — the server-side
// branch exists so importing this module during SSR still yields a valid URL.
function resolveRpcUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (explicit) return explicit;
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return `http://localhost:${process.env.PORT ?? 3000}/api/rpc`;
}

export const SOLANA_RPC_URL = resolveRpcUrl();
export const SOLANA_EXPLORER_URL = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL;
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT;

export function explorerTxUrl(signature: string): string {
  if (SOLANA_EXPLORER_URL) return `${SOLANA_EXPLORER_URL.replace(/\/$/, "")}/tx/${signature}`;
  const clusterParam = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

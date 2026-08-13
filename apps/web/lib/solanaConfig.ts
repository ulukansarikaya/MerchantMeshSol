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
export const SOLANA_RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
export const SOLANA_EXPLORER_URL = process.env.NEXT_PUBLIC_SOLANA_EXPLORER_URL;
export const USDC_MINT = process.env.NEXT_PUBLIC_USDC_MINT;

export function explorerTxUrl(signature: string): string {
  if (SOLANA_EXPLORER_URL) return `${SOLANA_EXPLORER_URL.replace(/\/$/, "")}/tx/${signature}`;
  const clusterParam = SOLANA_CLUSTER === "mainnet-beta" ? "" : `?cluster=${SOLANA_CLUSTER}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

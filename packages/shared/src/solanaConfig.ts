import { createSolanaRpc } from "@solana/kit";

/**
 * Single source of truth for "which Solana cluster are we on" — read once from
 * env, used by the bridge, merchant-agents, and (via NEXT_PUBLIC_* mirrors) the
 * web app. Never hardcode a cluster name/RPC URL anywhere else.
 *
 * Unlike EVM chains, Solana clusters don't have a numeric chain id — the
 * cluster name (devnet/testnet/mainnet-beta) plus the RPC URL is the whole
 * identity. `localnet` covers a local `solana-test-validator`.
 */
export type SolanaCluster = "localnet" | "devnet" | "testnet" | "mainnet-beta";

const KNOWN_CLUSTERS: readonly SolanaCluster[] = ["localnet", "devnet", "testnet", "mainnet-beta"];

export interface SolanaEnvConfig {
  rpcUrl: string;
  cluster: SolanaCluster;
  explorerUrl?: string;
}

export function readSolanaEnvConfig(env: Record<string, string | undefined> = process.env): SolanaEnvConfig {
  const rpcUrl = env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    throw new Error("SOLANA_RPC_URL must be set to build a Solana config (see .env.example).");
  }
  const clusterRaw = env.SOLANA_CLUSTER ?? "devnet";
  if (!KNOWN_CLUSTERS.includes(clusterRaw as SolanaCluster)) {
    throw new Error(`SOLANA_CLUSTER must be one of ${KNOWN_CLUSTERS.join(", ")}, got: ${clusterRaw}`);
  }
  return {
    rpcUrl,
    cluster: clusterRaw as SolanaCluster,
    explorerUrl: env.SOLANA_EXPLORER_URL,
  };
}

/**
 * Read-only RPC client. There is no Solana equivalent of viem's "wallet
 * client" object — transactions are built explicitly (compile a message from
 * instructions, sign with a `KeyPairSigner`, send via this same RPC client)
 * rather than through a persistent per-account client. See solanaKeys.ts for
 * signer construction.
 */
export function createSolanaRpcClient(cfg: SolanaEnvConfig) {
  return createSolanaRpc(cfg.rpcUrl);
}

/** Builds an explorer tx URL; falls back to explorer.solana.com with a ?cluster= param. */
export function explorerTxUrl(cfg: SolanaEnvConfig, signature: string): string {
  if (cfg.explorerUrl) return `${cfg.explorerUrl.replace(/\/$/, "")}/tx/${signature}`;
  const clusterParam = cfg.cluster === "mainnet-beta" ? "" : `?cluster=${cfg.cluster}`;
  return `https://explorer.solana.com/tx/${signature}${clusterParam}`;
}

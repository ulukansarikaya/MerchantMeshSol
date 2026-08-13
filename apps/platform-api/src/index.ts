import { serve } from "@hono/node-server";
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { env, envInt, loadRootEnv } from "@merchantmesh/shared/env";
import { readSolanaEnvConfig, createSolanaRpcClient, hexToBytes } from "@merchantmesh/shared";
import { getDb, getRedis } from "@merchantmesh/db";
import { createPlatformApp } from "./app.js";

loadRootEnv();

const db = getDb();
const chainConfig = readSolanaEnvConfig();
const rpc = createSolanaRpcClient(chainConfig);

let redis;
try {
  redis = getRedis();
} catch {
  console.warn("[platform-api] REDIS_URL not set — /auth/* rate limiting disabled.");
}

const usdcMintEnv = process.env.USDC_MINT;

// Faz 2/3 — same relayer key apps/merchant-agents and scripts/init-devnet.ts already use
// to sign admin-authority on-chain calls (list_merchant/set_merchant_wallet/resolve).
// Merchant self-service routes (/merchant-agents, /admin/*, disputes) are simply absent
// (not 501) if this isn't set — see app.ts's registerMerchantRoutes guard.
const relayerKeyEnv = process.env.RELAYER_PRIVATE_KEY;
const relayer = relayerKeyEnv ? await createKeyPairSignerFromPrivateKeyBytes(hexToBytes(relayerKeyEnv)) : undefined;
const operatorAccountIds = new Set(
  (process.env.PLATFORM_OPERATOR_ACCOUNT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
if (relayer && operatorAccountIds.size === 0) {
  console.warn("[platform-api] PLATFORM_OPERATOR_ACCOUNT_IDS is empty — no account can publish merchants or resolve disputes.");
}

const app = createPlatformApp({
  db,
  rpc,
  webOrigin: env("WEB_ORIGIN", "http://localhost:3000"),
  redis,
  chainConfig,
  usdcMint: usdcMintEnv ? address(usdcMintEnv) : undefined,
  relayer,
  operatorAccountIds,
  merchantsUrl: env("MERCHANTS_URL", "http://localhost:4000"),
});

const port = envInt("PLATFORM_API_PORT", 3002);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[platform-api] auth + accounts on http://localhost:${port}`);
});

import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { address } from "@solana/kit";
import { env, envBool, envInt, loadRootEnv } from "@merchantmesh/shared/env";
import { readSolanaEnvConfig, createSolanaRpcClient } from "@merchantmesh/shared";
import { openDb, seedDb } from "./db.js";
import { createMerchantApp } from "./app.js";
import { MockChainClient, SolanaMerchantChainClient, type MerchantChainClient } from "./chainClient.js";
import { createDiscountProvider } from "./discountProvider.js";

loadRootEnv();

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.MERCHANTS_DB_PATH ?? join(here, "..", "data", "merchants.db");

const db = openDb(dbPath);
const merchantCount = (db.prepare("SELECT COUNT(*) AS c FROM merchants").get() as { c: number }).c;
if (merchantCount === 0) {
  console.log("[merchants] empty database — seeding 5 merchants");
  await seedDb(db);
}

const mockChain = envBool("MOCK_CHAIN", true);
const bridgeUrl = env("BRIDGE_URL", "http://localhost:3001");
let chain: MerchantChainClient;
if (mockChain) {
  chain = new MockChainClient(bridgeUrl);
} else {
  const usdcMintEnv = process.env.USDC_MINT;
  if (!usdcMintEnv) {
    console.warn("[merchants] MOCK_CHAIN=false but USDC_MINT is unset — degrading to MockChainClient.");
    chain = new MockChainClient(bridgeUrl);
  } else {
    chain = new SolanaMerchantChainClient(readSolanaEnvConfig(), address(usdcMintEnv), envInt("CHAIN_MIN_CONFIRMATIONS", 1));
  }
}

// Faz J §2 — real (non-mock) payment verification needs to read confirmed transactions back.
const mockPayments = envBool("MOCK_PAYMENTS", true);
const usdcMintEnv = process.env.USDC_MINT;
const rpc = !mockPayments && usdcMintEnv ? createSolanaRpcClient(readSolanaEnvConfig()) : undefined;
if (!mockPayments && !usdcMintEnv) {
  console.warn("[merchants] MOCK_PAYMENTS=false but USDC_MINT is unset — real payment verification will 501.");
}

const prepTimeout = envBool("DEMO_PREP_TIMEOUT", false);
const { app, worker } = createMerchantApp({
  db,
  chain,
  mockPayments,
  mockSecret: env("MOCK_PAYMENT_SECRET", "merchantmesh-mock-secret"),
  bridgeUrl,
  notifyBridge: true,
  chainName: env("SOLANA_CLUSTER", "mock"),
  usdcAsset: env("USDC_MINT", "USDC"),
  rpc,
  usdcMint: usdcMintEnv ? address(usdcMintEnv) : undefined,
  demoPrepTimeoutShop: prepTimeout ? env("DEMO_PREP_TIMEOUT_SHOP", "cem-firin") : undefined,
  prepTimeoutSecs: envInt("DEMO_PREP_TIMEOUT_SECS", 6),
  discountProvider: createDiscountProvider(),
});

const port = envInt("MERCHANTS_PORT", 4000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`[merchants] 5-merchant agent service on http://localhost:${port} (mock payments: ${envBool("MOCK_PAYMENTS", true)})`);
  if (prepTimeout) console.log(`[merchants] DEMO_PREP_TIMEOUT active for shop: ${env("DEMO_PREP_TIMEOUT_SHOP", "cem-firin")}`);
});
worker.start();

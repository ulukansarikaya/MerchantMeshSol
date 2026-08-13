import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRootEnv } from "../packages/shared/src/env.js";
import { openDb as openMerchantDb, seedDb } from "../apps/merchant-agents/src/db.js";
import { openDb as openBridgeDb } from "../apps/local-agent-bridge/src/db.js";
import { MockChainProvider } from "../apps/local-agent-bridge/src/chain.js";

loadRootEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const merchantDbPath = process.env.MERCHANTS_DB_PATH ?? join(root, "apps", "merchant-agents", "data", "merchants.db");
const merchantDb = openMerchantDb(merchantDbPath);
merchantDb.exec("DELETE FROM quotes; DELETE FROM reservations; DELETE FROM orders; DELETE FROM idempotency; DELETE FROM payments_seen;");
seedDb(merchantDb);
const count = (merchantDb.prepare("SELECT COUNT(*) AS c FROM merchants").get() as { c: number }).c;
console.log(`[seed] merchants: ${count} merchants → ${merchantDbPath}`);

const bridgeDbPath = process.env.BRIDGE_DB_PATH ?? join(root, "apps", "local-agent-bridge", "data", "bridge.db");
const bridgeDb = openBridgeDb(bridgeDbPath);
bridgeDb.exec(`
  DELETE FROM tasks; DELETE FROM task_events; DELETE FROM spend; DELETE FROM quotes_seen;
  DELETE FROM task_orders; DELETE FROM dropped_shops; DELETE FROM feedback;
  DELETE FROM chain_wallet; DELETE FROM chain_escrows; DELETE FROM chain_receipts; DELETE FROM chain_feedback;
`);
const chain = new MockChainProvider(bridgeDb);
console.log(`[seed] bridge: session wallet ${chain.walletAddress()} funded with ${chain.walletBalanceMicroUsdc()} µUSDC → ${bridgeDbPath}`);

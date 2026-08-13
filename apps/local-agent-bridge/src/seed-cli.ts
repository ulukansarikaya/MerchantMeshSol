import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRootEnv } from "@merchantmesh/shared/env";
import { openDb } from "./db.js";
import { MockChainProvider } from "./chain.js";

loadRootEnv();
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.BRIDGE_DB_PATH ?? join(here, "..", "data", "bridge.db");
const db = openDb(dbPath);
db.exec(`
  DELETE FROM tasks; DELETE FROM task_events; DELETE FROM spend; DELETE FROM quotes_seen;
  DELETE FROM task_orders; DELETE FROM dropped_shops; DELETE FROM feedback;
  DELETE FROM chain_wallet; DELETE FROM chain_escrows; DELETE FROM chain_receipts; DELETE FROM chain_feedback;
`);
const chain = new MockChainProvider(db); // re-creates the funded session wallet
console.log(`[bridge] reset ${dbPath} — session wallet ${chain.walletAddress()} funded with ${await chain.walletBalanceMicroUsdc()} µUSDC`);

/** Refresh only the five local merchant agents; leaves bridge tasks untouched. */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRootEnv } from "../packages/shared/src/env.js";
import { openDb, seedDb } from "../apps/merchant-agents/src/db.js";

loadRootEnv();
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.MERCHANTS_DB_PATH ?? join(root, "apps", "merchant-agents", "data", "merchants.db");
const db = openDb(dbPath);
await seedDb(db);
const merchantCount = (db.prepare("SELECT COUNT(*) AS count FROM merchants").get() as { count: number }).count;
const inventoryCount = (db.prepare("SELECT COUNT(*) AS count FROM inventory").get() as { count: number }).count;
db.close();
console.log(`[seed-merchants] ${merchantCount} merchants, ${inventoryCount} inventory rows refreshed.`);

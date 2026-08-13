import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadRootEnv } from "@merchantmesh/shared/env";
import { openDb, seedDb } from "./db.js";

loadRootEnv();
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.MERCHANTS_DB_PATH ?? join(here, "..", "data", "merchants.db");
const db = openDb(dbPath);
db.exec("DELETE FROM quotes; DELETE FROM reservations; DELETE FROM orders; DELETE FROM idempotency; DELETE FROM payments_seen;");
await seedDb(db);
const count = (db.prepare("SELECT COUNT(*) AS c FROM merchants").get() as { c: number }).c;
console.log(`[merchants] seeded ${count} merchants into ${dbPath}`);

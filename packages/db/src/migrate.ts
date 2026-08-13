import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { loadRootEnv } from "@merchantmesh/shared/env";

loadRootEnv();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set — see .env.example.");
  process.exit(1);
}

const pool = new Pool({ connectionString });
const db = drizzle(pool);

console.log(`[db] applying migrations from packages/db/migrations …`);
await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
console.log("[db] migrations applied.");
await pool.end();

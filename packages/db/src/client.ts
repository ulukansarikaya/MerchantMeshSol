import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema/index.js";

let pool: Pool | undefined;

/** Lazily-created singleton pg Pool + drizzle instance, keyed off DATABASE_URL. */
export function getDb() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — see .env.example.");
    }
    pool = new Pool({ connectionString });
    // pg's Pool emits 'error' on any idle client that drops its connection in
    // the background (e.g. a flaky network blip) — with no listener, Node's
    // EventEmitter treats an unhandled 'error' event as fatal and crashes the
    // whole process. Log and move on instead; the next query just gets a
    // fresh connection from the pool once the DB is reachable again.
    pool.on("error", (err) => {
      console.error("[db] pg pool error on an idle client (connection likely dropped):", err.message);
    });
  }
  return drizzle(pool, { schema });
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export type Db = ReturnType<typeof getDb>;

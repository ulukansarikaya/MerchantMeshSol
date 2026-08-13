import { afterAll, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { getDb, closeDb, merchantOrganizations, merchantLocations, agentMemories, agents, accounts } from "../src/index.js";
import { ewktPoint } from "../src/types.js";

// DB-dependent smoke tests — skipped entirely when DATABASE_URL is unset so
// the rest of the workspace's `pnpm test` never depends on a live Postgres.
// See plans/faz-a.md §4.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("packages/db — Postgres smoke tests", () => {
  afterAll(async () => {
    if (hasDb) await closeDb();
  });

  it("finds merchants within a PostGIS radius of the Kızılay home point", async () => {
    const db = getDb();
    const HOME_LAT = 39.9208;
    const HOME_LNG = 32.8541;
    const rows = await db.execute(sql`
      SELECT mo.slug, ST_Distance(ml.location, ST_GeogFromText(${ewktPoint(HOME_LAT, HOME_LNG)})) AS distance_m
      FROM merchant_locations ml
      JOIN merchant_organizations mo ON mo.id = ml.merchant_id
      WHERE ST_DWithin(ml.location, ST_GeogFromText(${ewktPoint(HOME_LAT, HOME_LNG)}), 1500)
      ORDER BY distance_m
    `);
    expect(rows.rows.length).toBe(5);
  });

  it("round-trips a pgvector embedding and computes a distance", async () => {
    const db = getDb();
    const [account] = await db.insert(accounts).values({}).returning();
    const [agent] = await db.insert(agents).values({ accountId: account!.id }).returning();
    const embedding = Array.from({ length: 1536 }, (_, i) => (i % 7) / 7);
    await db.insert(agentMemories).values({
      agentId: agent!.id,
      memoryType: "episodic",
      content: "test memory",
      embedding,
    });
    const rows = await db.execute(sql`
      SELECT embedding <-> ${`[${embedding.join(",")}]`}::vector AS distance
      FROM agent_memories WHERE agent_id = ${agent!.id}
    `);
    expect(Number(rows.rows[0]!.distance)).toBeCloseTo(0, 5);
  });

  it("rejects a negative available_quantity via the inventory CHECK constraint", async () => {
    const db = getDb();
    await expect(
      db.execute(sql`
        INSERT INTO inventory (warehouse_id, merchant_product_id, physical_quantity, reserved_quantity, available_quantity)
        VALUES (gen_random_uuid(), gen_random_uuid(), 5, 10, -5)
      `),
    ).rejects.toThrow();
  });

  it("stores and reads back a merchant location via PostGIS geography", async () => {
    const db = getDb();
    const [org] = await db
      .insert(merchantOrganizations)
      .values({ slug: `test-${Date.now()}`, name: "Test Merchant", category: "market" })
      .returning();
    try {
      await db.insert(merchantLocations).values({ merchantId: org!.id, location: ewktPoint(39.92, 32.85) });
      const found = await db.select().from(merchantLocations).where(eq(merchantLocations.merchantId, org!.id));
      expect(found).toHaveLength(1);
    } finally {
      // Cascades to merchant_locations — keeps this idempotent across reruns
      // so it doesn't pollute the "5 seed merchants within radius" test above.
      await db.delete(merchantOrganizations).where(eq(merchantOrganizations.id, org!.id));
    }
  });
});

// Avoids a bare "no test files matched" surprise when DATABASE_URL is unset.
describe.skipIf(hasDb)("packages/db — Postgres smoke tests (skipped, no DATABASE_URL)", () => {
  it("is a no-op placeholder", () => {
    expect(true).toBe(true);
  });
});

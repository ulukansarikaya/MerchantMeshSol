import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  getDb,
  closeDb,
  merchantOrganizations,
  merchantProducts,
  warehouses,
  inventory,
  ewktPoint,
  reserveInventoryAtomic,
  commitStockForOrder,
  restockAfterCancel,
  releaseExpiredReservations,
  getCatalogLine,
  InsufficientStockError,
} from "../src/index.js";

// Faz I §1c — atomic reservation smoke tests. Skipped entirely when
// DATABASE_URL is unset, matching packages/db/test/db.test.ts's pattern.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("packages/db — merchant reservation atomicity (Faz I §1)", () => {
  afterAll(async () => {
    if (hasDb) await closeDb();
  });

  /**
   * A throwaway merchant + single low-stock product, cleaned up after each
   * test. Reuses the "domates" canonical SKU (seeded by scripts/seed-pg.ts)
   * rather than a fake one — merchant_products.canonical_sku FKs to products.
   */
  async function withTestMerchant<T>(stockQty: number, fn: (merchantId: string, sku: string) => Promise<T>): Promise<T> {
    const db = getDb();
    const slug = `test-merchant-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const sku = "domates";
    const [org] = await db
      .insert(merchantOrganizations)
      .values({ slug, name: "Test Merchant", category: "market" })
      .returning();
    try {
      const [wh] = await db
        .insert(warehouses)
        .values({ merchantId: org!.id, name: "Test Depo", location: ewktPoint(39.92, 32.85), active: true })
        .returning();
      const [mp] = await db
        .insert(merchantProducts)
        .values({
          merchantId: org!.id,
          canonicalSku: sku,
          merchantProductName: sku,
          unitType: "adet",
          basePriceMicroUsdc: 1_000_000n,
          minimumPriceMicroUsdc: 900_000n,
          active: true,
        })
        .returning();
      await db.insert(inventory).values({
        warehouseId: wh!.id,
        merchantProductId: mp!.id,
        physicalQuantity: stockQty,
        reservedQuantity: 0,
        availableQuantity: stockQty,
      });
      return await fn(org!.id, sku);
    } finally {
      // Cascades through warehouses/merchant_products/inventory.
      await db.delete(merchantOrganizations).where(eq(merchantOrganizations.id, org!.id));
    }
  }

  it("under concurrent reservations, exactly the available stock is granted and no more", async () => {
    await withTestMerchant(2, async (merchantId, sku) => {
      const attempts = 10;
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () => reserveInventoryAtomic(getDb(), { merchantId, sku, qty: 1, ttlSeconds: 60 })),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(attempts - 2);
      for (const r of rejected) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientStockError);
      }
      const line = await getCatalogLine(getDb(), merchantId, sku);
      expect(line!.availableQty).toBe(0);
    });
  }, 20_000);

  it("commitStockForOrder consumes a held reservation without double-counting", async () => {
    await withTestMerchant(5, async (merchantId, sku) => {
      const db = getDb();
      const { reservationId } = await reserveInventoryAtomic(db, { merchantId, sku, qty: 3, ttlSeconds: 60 });
      expect(reservationId).toBeTruthy();

      await commitStockForOrder(db, merchantId, [{ sku, qty: 3 }]);

      const line = await getCatalogLine(db, merchantId, sku);
      // physical 5 - 3 sold = 2; available was already 5-3(reserved)=2, unaffected by commit.
      expect(line!.availableQty).toBe(2);
    });
  });

  it("commitStockForOrder falls back to a direct decrement when no reservation exists", async () => {
    await withTestMerchant(4, async (merchantId, sku) => {
      const db = getDb();
      await commitStockForOrder(db, merchantId, [{ sku, qty: 4 }]);
      const line = await getCatalogLine(db, merchantId, sku);
      expect(line!.availableQty).toBe(0);
      await expect(commitStockForOrder(db, merchantId, [{ sku, qty: 1 }])).rejects.toBeInstanceOf(InsufficientStockError);
    });
  });

  it("restockAfterCancel returns committed stock to available+physical", async () => {
    await withTestMerchant(2, async (merchantId, sku) => {
      const db = getDb();
      await commitStockForOrder(db, merchantId, [{ sku, qty: 2 }]);
      expect((await getCatalogLine(db, merchantId, sku))!.availableQty).toBe(0);
      await restockAfterCancel(db, merchantId, [{ sku, qty: 2 }]);
      expect((await getCatalogLine(db, merchantId, sku))!.availableQty).toBe(2);
    });
  });

  it("releaseExpiredReservations returns held-but-expired stock to available", async () => {
    await withTestMerchant(3, async (merchantId, sku) => {
      const db = getDb();
      await reserveInventoryAtomic(db, { merchantId, sku, qty: 3, ttlSeconds: -1 }); // already expired
      expect((await getCatalogLine(db, merchantId, sku))!.availableQty).toBe(0);
      const released = await releaseExpiredReservations(db);
      expect(released).toBeGreaterThanOrEqual(1);
      expect((await getCatalogLine(db, merchantId, sku))!.availableQty).toBe(3);
    });
  });
});

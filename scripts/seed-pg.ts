/**
 * Migrates the existing 5-merchant SQLite seed into the relational Postgres
 * model (Faz A). Idempotent: safe to re-run, upserts by natural key.
 */
import { eq, like } from "drizzle-orm";
import {
  getDb,
  closeDb,
  merchantOrganizations,
  merchantWallets,
  merchantSettings,
  merchantLocations,
  merchantHours,
  products,
  merchantProducts,
  warehouses,
  inventory,
  reservations,
  ewktPoint,
} from "../packages/db/src/index.js";
import { CANONICAL_SKUS, SEED_MERCHANTS } from "../packages/shared/src/index.js";
import { loadRootEnv } from "../packages/shared/src/env.js";

loadRootEnv();

async function main() {
  const db = getDb();

  // Remove disposable records left by browser/E2E merchant-onboarding runs.
  await db.delete(merchantOrganizations).where(like(merchantOrganizations.slug, "e2e-test-%"));
  // Inventory is reset below, so stale holds from older demo tasks must not
  // later decrement the freshly reset reserved_quantity below zero.
  await db.delete(reservations).where(eq(reservations.status, "held"));

  console.log(`[seed-pg] upserting ${CANONICAL_SKUS.length} canonical products…`);
  for (const p of CANONICAL_SKUS) {
    await db
      .insert(products)
      .values({
        sku: p.sku,
        nameTr: p.nameTr,
        nameEn: p.nameEn,
        category: p.category,
        unit: p.unit,
        essential: p.essential,
      })
      .onConflictDoUpdate({
        target: products.sku,
        set: { nameTr: p.nameTr, nameEn: p.nameEn, category: p.category, unit: p.unit, essential: p.essential },
      });
  }

  for (const m of SEED_MERCHANTS) {
    console.log(`[seed-pg] upserting merchant ${m.slug}…`);

    const [org] = await db
      .insert(merchantOrganizations)
      .values({
        slug: m.slug,
        name: m.name,
        category: m.category,
        qualityScore: m.qualityScore,
        active: true,
        erc8004AgentId: m.agentId,
      })
      .onConflictDoUpdate({
        target: merchantOrganizations.slug,
        set: { name: m.name, category: m.category, qualityScore: m.qualityScore, active: true },
      })
      .returning();
    const merchantId = org!.id;

    await db
      .insert(merchantWallets)
      .values({ merchantId, address: m.wallet, isPayout: true })
      .onConflictDoUpdate({ target: merchantWallets.address, set: { merchantId, isPayout: true } });

    await db
      .insert(merchantSettings)
      .values({
        merchantId,
        negotiationEnabled: m.negotiation.enabled,
        maxDiscountBps: m.negotiation.maxDiscountBps,
        autoReserve: m.reservation.enabled,
        reservationTtlSec: m.reservation.ttlSeconds || 600,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: merchantSettings.merchantId,
        set: {
          negotiationEnabled: m.negotiation.enabled,
          maxDiscountBps: m.negotiation.maxDiscountBps,
          autoReserve: m.reservation.enabled,
          reservationTtlSec: m.reservation.ttlSeconds || 600,
          updatedAt: new Date(),
        },
      });

    await db
      .insert(merchantLocations)
      .values({ merchantId, location: ewktPoint(m.lat, m.lng), updatedAt: new Date() })
      .onConflictDoUpdate({ target: merchantLocations.merchantId, set: { location: ewktPoint(m.lat, m.lng), updatedAt: new Date() } });

    const [wh] = await db
      .select()
      .from(warehouses)
      .where(eq(warehouses.merchantId, merchantId))
      .limit(1);
    const warehouseId =
      wh?.id ??
      (
        await db
          .insert(warehouses)
          .values({ merchantId, name: "Main Warehouse", location: ewktPoint(m.lat, m.lng), active: true })
          .returning()
      )[0]!.id;
    if (wh) {
      await db.update(warehouses).set({ name: "Main Warehouse", active: true }).where(eq(warehouses.id, wh.id));
    }

    const [openHour, closeHour] = m.openingHours.split("-");
    for (let weekday = 0; weekday <= 6; weekday++) {
      await db
        .insert(merchantHours)
        .values({ merchantId, weekday, opensAt: openHour ?? "08:00", closesAt: closeHour ?? "20:00" })
        .onConflictDoUpdate({
          target: [merchantHours.merchantId, merchantHours.weekday],
          set: { opensAt: openHour ?? "08:00", closesAt: closeHour ?? "20:00" },
        });
    }

    for (const item of m.inventory) {
      const [mp] = await db
        .insert(merchantProducts)
        .values({
          merchantId,
          canonicalSku: item.sku,
          merchantProductName: item.sku,
          unitType: "adet",
          basePriceMicroUsdc: BigInt(item.priceMicroUsdc),
          minimumPriceMicroUsdc: BigInt(item.minPriceMicroUsdc),
          active: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [merchantProducts.merchantId, merchantProducts.canonicalSku],
          set: {
            basePriceMicroUsdc: BigInt(item.priceMicroUsdc),
            minimumPriceMicroUsdc: BigInt(item.minPriceMicroUsdc),
            active: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      await db
        .insert(inventory)
        .values({
          warehouseId,
          merchantProductId: mp!.id,
          physicalQuantity: item.stockQty,
          reservedQuantity: 0,
          availableQuantity: item.stockQty,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [inventory.warehouseId, inventory.merchantProductId],
          set: {
            physicalQuantity: item.stockQty,
            reservedQuantity: 0,
            availableQuantity: item.stockQty,
            updatedAt: new Date(),
          },
        });
    }
  }

  console.log(`[seed-pg] done — ${SEED_MERCHANTS.length} merchants seeded into Postgres.`);
  await closeDb();
}

main().catch((err) => {
  console.error("[seed-pg] failed:", err);
  process.exit(1);
});

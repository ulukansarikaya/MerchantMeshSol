import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  merchantOrganizations,
  merchantWallets,
  merchantSettings,
  merchantLocations,
  merchantHours,
  merchantProducts,
  warehouses,
  inventory,
  inventoryMovements,
  reservations,
} from "../schema/index.js";

/**
 * Faz I §1 — merchant-agents' Postgres-backed catalog/inventory/reservation
 * layer. Signing keys, ERC-8004 verification flags, and the `pickup` flag
 * are NOT stored here (private keys never touch the DB; verification/pickup
 * aren't columns in the Faz A schema yet) — callers merge those in from
 * `SEED_MERCHANTS` (packages/shared). See DECISIONS.md.
 */
export class InsufficientStockError extends Error {
  constructor(public sku: string) {
    super(`insufficient_stock: ${sku}`);
  }
}

export interface MerchantOrgInfo {
  id: string;
  slug: string;
  name: string;
  category: string;
  qualityScore: number;
  active: boolean;
  erc8004AgentId: number | null;
  wallet: string;
  negotiationEnabled: boolean;
  maxDiscountBps: number;
  reservationEnabled: boolean;
  reservationTtlSec: number;
  openingHours: string;
  lat: number;
  lng: number;
  /** Faz 2 — set only once an operator has published this org on-chain; the numeric id merchant-agents/quotes/PDAs use for self-service merchants. */
  onChainMerchantId: bigint | null;
  /** Faz 2 — AES-256-GCM envelope, null for the 5 SEED_MERCHANTS orgs (those sign with devSignerKey/env override instead). */
  encryptedSignerKey: string | null;
  /** Faz 3 — balanced | aggressive | conservative; drives discountProvider.ts's tone. */
  agentStrategy: string | null;
}

export async function getMerchantOrgBySlug(db: Db, slug: string): Promise<MerchantOrgInfo | undefined> {
  const [org] = await db.select().from(merchantOrganizations).where(eq(merchantOrganizations.slug, slug)).limit(1);
  if (!org) return undefined;
  const [wallet] = await db
    .select({ address: merchantWallets.address })
    .from(merchantWallets)
    .where(and(eq(merchantWallets.merchantId, org.id), eq(merchantWallets.isPayout, true)))
    .limit(1);
  const [settings] = await db.select().from(merchantSettings).where(eq(merchantSettings.merchantId, org.id)).limit(1);
  const [hours] = await db
    .select()
    .from(merchantHours)
    .where(and(eq(merchantHours.merchantId, org.id), eq(merchantHours.weekday, 1)))
    .limit(1);
  const [loc] = await db.execute(
    sql`SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM merchant_locations WHERE merchant_id = ${org.id}`,
  ).then((r) => r.rows as { lat: string; lng: string }[]);

  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    category: org.category,
    qualityScore: org.qualityScore,
    active: org.active,
    erc8004AgentId: org.erc8004AgentId,
    wallet: wallet?.address ?? "",
    negotiationEnabled: settings?.negotiationEnabled ?? false,
    maxDiscountBps: settings?.maxDiscountBps ?? 0,
    reservationEnabled: settings?.autoReserve ?? false,
    reservationTtlSec: settings?.reservationTtlSec ?? 600,
    openingHours: hours ? `${hours.opensAt}-${hours.closesAt}` : "08:00-20:00",
    lat: loc ? Number(loc.lat) : 0,
    lng: loc ? Number(loc.lng) : 0,
    onChainMerchantId: org.onChainMerchantId,
    encryptedSignerKey: org.encryptedSignerKey,
    agentStrategy: org.agentStrategy,
  };
}

/** Faz 2 — self-service merchants (no SEED_MERCHANTS entry) are looked up by their published on-chain id, not a slug. */
export async function getMerchantOrgByOnChainMerchantId(db: Db, onChainMerchantId: bigint): Promise<MerchantOrgInfo | undefined> {
  const [org] = await db
    .select({ slug: merchantOrganizations.slug })
    .from(merchantOrganizations)
    .where(eq(merchantOrganizations.onChainMerchantId, onChainMerchantId))
    .limit(1);
  if (!org) return undefined;
  return getMerchantOrgBySlug(db, org.slug);
}

export async function getMerchantOrgIdBySlug(db: Db, slug: string): Promise<string | undefined> {
  const [org] = await db.select({ id: merchantOrganizations.id }).from(merchantOrganizations).where(eq(merchantOrganizations.slug, slug)).limit(1);
  return org?.id;
}

export async function getMerchantOrgSlugById(db: Db, id: string): Promise<string | undefined> {
  const [org] = await db.select({ slug: merchantOrganizations.slug }).from(merchantOrganizations).where(eq(merchantOrganizations.id, id)).limit(1);
  return org?.slug;
}

/** Display name (e.g. "Green Basket") vs the URL/PDA-facing slug (e.g. "zeynep-manav") — for anywhere the UI shows a merchant to a customer. */
export async function getMerchantOrgNameById(db: Db, id: string): Promise<string | undefined> {
  const [org] = await db.select({ name: merchantOrganizations.name }).from(merchantOrganizations).where(eq(merchantOrganizations.id, id)).limit(1);
  return org?.name;
}

export async function listActiveMerchantOrgs(db: Db): Promise<MerchantOrgInfo[]> {
  const rows = await db.select({ slug: merchantOrganizations.slug }).from(merchantOrganizations).where(eq(merchantOrganizations.active, true));
  const out: MerchantOrgInfo[] = [];
  for (const r of rows) {
    const info = await getMerchantOrgBySlug(db, r.slug);
    if (info) out.push(info);
  }
  return out;
}

export interface CatalogLine {
  merchantProductId: string;
  warehouseId: string;
  sku: string;
  priceMicroUsdc: number;
  minPriceMicroUsdc: number;
  availableQty: number;
}

export async function getMerchantCatalog(db: Db, merchantId: string, skus?: string[]): Promise<CatalogLine[]> {
  const rows = await db
    .select({
      merchantProductId: merchantProducts.id,
      sku: merchantProducts.canonicalSku,
      priceMicroUsdc: merchantProducts.basePriceMicroUsdc,
      minPriceMicroUsdc: merchantProducts.minimumPriceMicroUsdc,
      warehouseId: inventory.warehouseId,
      availableQty: inventory.availableQuantity,
    })
    .from(merchantProducts)
    .innerJoin(inventory, eq(inventory.merchantProductId, merchantProducts.id))
    .where(and(eq(merchantProducts.merchantId, merchantId), eq(merchantProducts.active, true)));
  const filtered = skus ? rows.filter((r) => skus.includes(r.sku)) : rows;
  return filtered.map((r) => ({
    merchantProductId: r.merchantProductId,
    warehouseId: r.warehouseId,
    sku: r.sku,
    priceMicroUsdc: Number(r.priceMicroUsdc),
    minPriceMicroUsdc: Number(r.minPriceMicroUsdc),
    availableQty: r.availableQty,
  }));
}

export async function getCatalogLine(db: Db, merchantId: string, sku: string): Promise<CatalogLine | undefined> {
  const [line] = await getMerchantCatalog(db, merchantId, [sku]);
  return line;
}

/**
 * Atomically reserves `qty` units for TTL seconds. The `UPDATE ... WHERE
 * available_quantity >= qty` guard is what makes this race-free under
 * concurrent callers — Postgres serializes concurrent updates to the same
 * row, so exactly one loser sees zero affected rows and throws.
 *
 * `quoteId` is deliberately NOT persisted here (unlike the SQLite path):
 * `reservations.quoteId` FKs to `quotes_seen`, which only the bridge writes,
 * and only for Postgres-tracked tasks — persisting an unrelated merchant-side
 * quote id would risk an FK violation. Matching in `commitStockForOrder`
 * below falls back to oldest-held-first instead of quote-matching.
 */
export async function reserveInventoryAtomic(
  db: Db,
  params: { merchantId: string; sku: string; qty: number; ttlSeconds: number },
): Promise<{ reservationId: string; expiresAt: Date }> {
  return db.transaction(async (tx) => {
    const line = await getCatalogLine(tx as unknown as Db, params.merchantId, params.sku);
    if (!line) throw new InsufficientStockError(params.sku);

    const updated = await tx.execute(sql`
      UPDATE inventory
      SET reserved_quantity = reserved_quantity + ${params.qty},
          available_quantity = available_quantity - ${params.qty},
          version = version + 1,
          updated_at = now()
      WHERE merchant_product_id = ${line.merchantProductId} AND available_quantity >= ${params.qty}
      RETURNING id
    `);
    const invRow = (updated.rows as { id: string }[])[0];
    if (!invRow) throw new InsufficientStockError(params.sku);

    const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000);
    const [reservation] = await tx
      .insert(reservations)
      .values({
        merchantId: params.merchantId,
        inventoryId: invRow.id,
        quantity: params.qty,
        status: "held",
        expiresAt,
      })
      .returning();

    await tx.insert(inventoryMovements).values({
      inventoryId: invRow.id,
      movementType: "reserve",
      quantityDelta: -params.qty,
      sourceType: "reservation",
      sourceId: reservation!.id,
    });

    return { reservationId: reservation!.id, expiresAt };
  });
}

async function releaseHeldReservation(tx: Db, reservationId: string, status: "released" | "consumed"): Promise<void> {
  const [held] = await tx.select().from(reservations).where(eq(reservations.id, reservationId)).limit(1);
  if (!held || held.status !== "held") return;
  if (status === "released") {
    await tx.execute(sql`
      UPDATE inventory
      SET reserved_quantity = reserved_quantity - ${held.quantity},
          available_quantity = available_quantity + ${held.quantity},
          version = version + 1,
          updated_at = now()
      WHERE id = ${held.inventoryId}
    `);
    await tx.insert(inventoryMovements).values({
      inventoryId: held.inventoryId,
      movementType: "reservation_release",
      quantityDelta: held.quantity,
      sourceType: "reservation",
      sourceId: held.id,
    });
  }
  await tx.update(reservations).set({ status }).where(eq(reservations.id, reservationId));
}

/** Timeout worker: expire held reservations past TTL, return stock to available. Returns count released. */
export async function releaseExpiredReservations(db: Db): Promise<number> {
  const expired = await db
    .select({ id: reservations.id })
    .from(reservations)
    .where(and(eq(reservations.status, "held"), sql`${reservations.expiresAt} <= now()`));
  for (const r of expired) {
    await db.transaction((tx) => releaseHeldReservation(tx as unknown as Db, r.id, "released"));
  }
  return expired.length;
}

/**
 * Consumes a held reservation for (merchantId, sku) if one exists (oldest
 * first — see reserveInventoryAtomic's note on why quoteId isn't matched),
 * decrementing physical stock by the reservation's held amount and
 * returning any surplus to available. Falls back to a direct atomic
 * decrement (both physical and available) when no reservation covers it.
 */
export async function commitStockForOrder(
  db: Db,
  merchantId: string,
  items: { sku: string; qty: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) {
      const line = await getCatalogLine(tx as unknown as Db, merchantId, item.sku);
      if (!line) throw new InsufficientStockError(item.sku);

      const [held] = await tx
        .select({ id: reservations.id, quantity: reservations.quantity, inventoryId: reservations.inventoryId })
        .from(reservations)
        .innerJoin(inventory, eq(inventory.id, reservations.inventoryId))
        .where(
          and(
            eq(reservations.status, "held"),
            eq(inventory.merchantProductId, line.merchantProductId),
            sql`${reservations.expiresAt} > now()`,
          ),
        )
        .orderBy(asc(reservations.createdAt))
        .limit(1);

      if (held && held.quantity >= item.qty) {
        await tx.update(reservations).set({ status: "consumed" }).where(eq(reservations.id, held.id));
        const surplus = held.quantity - item.qty;
        await tx.execute(sql`
          UPDATE inventory
          SET reserved_quantity = reserved_quantity - ${held.quantity},
              physical_quantity = physical_quantity - ${item.qty},
              available_quantity = available_quantity + ${surplus},
              version = version + 1,
              updated_at = now()
          WHERE id = ${held.inventoryId}
        `);
        await tx.insert(inventoryMovements).values({
          inventoryId: held.inventoryId,
          movementType: "sale",
          quantityDelta: -item.qty,
          sourceType: "reservation",
          sourceId: held.id,
        });
        continue;
      }

      const updated = await tx.execute(sql`
        UPDATE inventory
        SET physical_quantity = physical_quantity - ${item.qty},
            available_quantity = available_quantity - ${item.qty},
            version = version + 1,
            updated_at = now()
        WHERE merchant_product_id = ${line.merchantProductId} AND available_quantity >= ${item.qty}
        RETURNING id
      `);
      const row = (updated.rows as { id: string }[])[0];
      if (!row) throw new InsufficientStockError(item.sku);
      await tx.insert(inventoryMovements).values({
        inventoryId: row.id,
        movementType: "sale",
        quantityDelta: -item.qty,
        sourceType: "order",
      });
    }
  });
}

/** Order cancelled after stock was committed — return goods to available+physical. */
export async function restockAfterCancel(db: Db, merchantId: string, items: { sku: string; qty: number }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const item of items) {
      const line = await getCatalogLine(tx as unknown as Db, merchantId, item.sku);
      if (!line) continue;
      await tx.execute(sql`
        UPDATE inventory
        SET physical_quantity = physical_quantity + ${item.qty},
            available_quantity = available_quantity + ${item.qty},
            version = version + 1,
            updated_at = now()
        WHERE merchant_product_id = ${line.merchantProductId}
      `);
      await tx.insert(inventoryMovements).values({
        inventoryId: (await tx.select({ id: inventory.id }).from(inventory).where(eq(inventory.merchantProductId, line.merchantProductId)).limit(1))[0]!.id,
        movementType: "return",
        quantityDelta: item.qty,
        sourceType: "order",
      });
    }
  });
}

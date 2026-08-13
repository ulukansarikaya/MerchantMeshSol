import { randomUUID } from "node:crypto";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import {
  getMerchant as sqliteGetMerchant,
  nowSec,
  type InventoryRow,
  type MerchantDb,
  type MerchantRow,
} from "./db.js";
import { SEED_MERCHANTS, bytesToHex, hexToBytes } from "@merchantmesh/shared";
import { loadMasterKey, decryptPrivateKey } from "@merchantmesh/shared/sessionWalletCrypto";
import {
  getDb,
  getMerchantOrgBySlug,
  getMerchantOrgByOnChainMerchantId,
  listActiveMerchantOrgs,
  getMerchantCatalog,
  reserveInventoryAtomic,
  commitStockForOrder as pgCommitStockForOrder,
  restockAfterCancel,
  releaseExpiredReservations as pgReleaseExpiredReservations,
  InsufficientStockError,
  type Db,
  type MerchantOrgInfo,
} from "@merchantmesh/db";

/**
 * Faz I §1 — merchant-agents' persistence interface. `SqliteMerchantStore`
 * wraps the existing node:sqlite tables byte-for-byte (used by every vitest
 * test and whenever DATABASE_URL is unset); `PostgresMerchantStore` backs
 * the same shape with real Postgres rows + atomic row-locked reservations
 * (plans/faz-i.md §1). Quotes/nonces/idempotency/payments_seen are NOT part
 * of this interface — they stay SQLite-only in both modes (ephemeral,
 * operational state, not listed in §1's table scope).
 */
export interface MerchantStore {
  getMerchant(idOrSlug: string): Promise<MerchantRow | undefined>;
  listActiveMerchants(): Promise<MerchantRow[]>;
  /** Faz 3 — the Postgres org uuid pricingDecisions logs against; undefined in SQLite mock mode (no Postgres row to log against). */
  getOrgId(merchantId: number): Promise<string | undefined>;
  getInventory(merchantId: number, skus?: string[]): Promise<InventoryRow[]>;
  getInventoryItem(merchantId: number, sku: string): Promise<InventoryRow | undefined>;
  /** Atomic TTL hold; throws Error("insufficient_stock: <sku>") if unavailable. */
  reserveStock(
    merchantId: number,
    sku: string,
    qty: number,
    ttlSeconds: number,
  ): Promise<{ reservationId: string; expiresAt: number }>;
  /** Commits stock for a confirmed order — consumes a matching held reservation if one exists. */
  commitStockForOrder(merchantId: number, items: { sku: string; qty: number }[]): Promise<void>;
  /** Restores stock after an order is cancelled post-commit. */
  restock(merchantId: number, items: { sku: string; qty: number }[]): Promise<void>;
  /** Timeout worker: releases reservations past TTL, returns held stock. Returns count released. */
  releaseExpiredReservations(): Promise<number>;
}

export class SqliteMerchantStore implements MerchantStore {
  constructor(private db: MerchantDb) {}

  async getMerchant(idOrSlug: string): Promise<MerchantRow | undefined> {
    return sqliteGetMerchant(this.db, idOrSlug);
  }

  async listActiveMerchants(): Promise<MerchantRow[]> {
    return this.db.prepare("SELECT * FROM merchants WHERE active = 1").all() as unknown as MerchantRow[];
  }

  async getOrgId(): Promise<string | undefined> {
    return undefined; // mock mode has no Postgres org row to log pricing decisions against
  }

  async getInventory(merchantId: number, skus?: string[]): Promise<InventoryRow[]> {
    const rows = this.db
      .prepare("SELECT * FROM inventory WHERE merchant_id = ?")
      .all(merchantId) as unknown as InventoryRow[];
    return skus ? rows.filter((r) => skus.includes(r.sku)) : rows;
  }

  async getInventoryItem(merchantId: number, sku: string): Promise<InventoryRow | undefined> {
    return this.db.prepare("SELECT * FROM inventory WHERE merchant_id = ? AND sku = ?").get(merchantId, sku) as
      | InventoryRow
      | undefined;
  }

  async reserveStock(
    merchantId: number,
    sku: string,
    qty: number,
    ttlSeconds: number,
  ): Promise<{ reservationId: string; expiresAt: number }> {
    const stock = await this.getInventoryItem(merchantId, sku);
    if (!stock || stock.stock_qty < qty) throw new Error(`insufficient_stock: ${sku}`);
    this.db.prepare("UPDATE inventory SET stock_qty = stock_qty - ? WHERE merchant_id = ? AND sku = ?").run(qty, merchantId, sku);
    const id = `r_${randomUUID()}`;
    const expiresAt = nowSec() + ttlSeconds;
    this.db
      .prepare("INSERT INTO reservations (reservation_id, merchant_id, sku, qty, quote_id, expires_at, status, created_at) VALUES (?, ?, ?, ?, NULL, ?, 'held', ?)")
      .run(id, merchantId, sku, qty, expiresAt, nowSec());
    return { reservationId: id, expiresAt };
  }

  async commitStockForOrder(merchantId: number, items: { sku: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      const held = this.db
        .prepare(
          "SELECT * FROM reservations WHERE merchant_id = ? AND sku = ? AND status = 'held' AND expires_at > ? ORDER BY created_at LIMIT 1",
        )
        .get(merchantId, item.sku, nowSec()) as
        | { reservation_id: string; qty: number }
        | undefined;
      if (held && held.qty >= item.qty) {
        this.db.prepare("UPDATE reservations SET status = 'consumed' WHERE reservation_id = ?").run(held.reservation_id);
        if (held.qty > item.qty) {
          this.db.prepare("UPDATE inventory SET stock_qty = stock_qty + ? WHERE merchant_id = ? AND sku = ?").run(
            held.qty - item.qty,
            merchantId,
            item.sku,
          );
        }
        continue;
      }
      const stock = await this.getInventoryItem(merchantId, item.sku);
      if (!stock || stock.stock_qty < item.qty) throw new Error(`insufficient_stock: ${item.sku}`);
      this.db.prepare("UPDATE inventory SET stock_qty = stock_qty - ? WHERE merchant_id = ? AND sku = ?").run(item.qty, merchantId, item.sku);
    }
  }

  async restock(merchantId: number, items: { sku: string; qty: number }[]): Promise<void> {
    for (const item of items) {
      this.db.prepare("UPDATE inventory SET stock_qty = stock_qty + ? WHERE merchant_id = ? AND sku = ?").run(item.qty, merchantId, item.sku);
    }
  }

  async releaseExpiredReservations(): Promise<number> {
    const now = nowSec();
    const expired = this.db
      .prepare("SELECT * FROM reservations WHERE status = 'held' AND expires_at <= ?")
      .all(now) as unknown as { reservation_id: string; merchant_id: number; sku: string; qty: number }[];
    for (const r of expired) {
      this.db.prepare("UPDATE inventory SET stock_qty = stock_qty + ? WHERE merchant_id = ? AND sku = ?").run(r.qty, r.merchant_id, r.sku);
      this.db.prepare("UPDATE reservations SET status = 'released' WHERE reservation_id = ?").run(r.reservation_id);
    }
    return expired.length;
  }
}

/**
 * Postgres-backed store. Signing keys, ERC-8004 verification flags, and the
 * `pickup` flag aren't columns in the Faz A schema (private keys never touch
 * the DB; verification/pickup weren't modeled yet) — merged in from
 * `SEED_MERCHANTS` by slug. See packages/db/src/repos/merchant.ts.
 */
export class PostgresMerchantStore implements MerchantStore {
  private db: Db;

  constructor() {
    this.db = getDb();
  }

  /**
   * Two very different merchants flow through here: the 5 fixed SEED_MERCHANTS
   * (unchanged since Faz 1 — signer key from env/dev-seed, numeric id from the
   * static array) and Faz 2 self-service merchants (signer key decrypted from
   * `encryptedSignerKey`, numeric id = their published on-chain merchant id —
   * `undefined` if not published yet, since an unpublished merchant has no
   * on-chain wallet/PDA to fund an escrow against).
   */
  private async toMerchantRow(org: MerchantOrgInfo | undefined): Promise<MerchantRow | undefined> {
    if (!org) return undefined;
    const seed = SEED_MERCHANTS.find((m) => m.slug === org.slug);

    if (seed) {
      const envOverride = process.env[seed.signerKeyEnv];
      const signerSeed = envOverride ? hexToBytes(envOverride) : seed.devSignerKey;
      const signerKey = bytesToHex(signerSeed);
      // Wallet is ALWAYS derived from whichever key actually signs — never
      // Postgres's stored wallet column, which was written once at seed-pg.ts
      // time from the dev key and goes stale the moment a real
      // MERCHANT_<SLUG>_PRIVATE_KEY shows up in env (same bug already fixed
      // for the SQLite path — see DECISIONS.md #36).
      const wallet = (await createKeyPairSignerFromPrivateKeyBytes(signerSeed)).address;
      return {
        merchant_id: seed.merchantId,
        slug: org.slug,
        name: org.name,
        category: org.category,
        lat: org.lat,
        lng: org.lng,
        wallet,
        signer_key: signerKey,
        quality_score: org.qualityScore,
        negotiation_enabled: org.negotiationEnabled ? 1 : 0,
        max_discount_bps: org.maxDiscountBps,
        reservation_enabled: org.reservationEnabled ? 1 : 0,
        reservation_ttl: org.reservationTtlSec,
        pickup: seed.pickup ? 1 : 0,
        opening_hours: org.openingHours,
        active: org.active ? 1 : 0,
        verification_json: JSON.stringify(seed.verification),
        agent_id: org.erc8004AgentId ?? seed.agentId,
      };
    }

    // Self-service merchant. Not published on-chain yet ⇒ no wallet/PDA to
    // fund an escrow against, so it isn't tradeable — treat as not found.
    if (org.onChainMerchantId === null || !org.encryptedSignerKey) return undefined;
    const signerSeed = hexToBytes(decryptPrivateKey(org.encryptedSignerKey, loadMasterKey()));
    const signerKey = bytesToHex(signerSeed);
    const wallet = (await createKeyPairSignerFromPrivateKeyBytes(signerSeed)).address;
    return {
      merchant_id: Number(org.onChainMerchantId),
      slug: org.slug,
      name: org.name,
      category: org.category,
      lat: org.lat,
      lng: org.lng,
      wallet,
      signer_key: signerKey,
      quality_score: org.qualityScore,
      negotiation_enabled: org.negotiationEnabled ? 1 : 0,
      max_discount_bps: org.maxDiscountBps,
      reservation_enabled: org.reservationEnabled ? 1 : 0,
      reservation_ttl: org.reservationTtlSec,
      pickup: 1,
      opening_hours: org.openingHours,
      active: org.active ? 1 : 0,
      // No attestation authority deployed yet (see AGENTS.md's "Gerçek Mod Geçiş
      // Noktaları") — self-service merchants get identity-only verification.
      verification_json: JSON.stringify({ identity: true, attestation: false, stake: false }),
      agent_id: org.erc8004AgentId ?? 0,
      agent_strategy: org.agentStrategy,
    };
  }

  async getMerchant(idOrSlug: string): Promise<MerchantRow | undefined> {
    const byId = Number(idOrSlug);
    if (Number.isInteger(byId) && byId > 0) {
      const seedSlug = SEED_MERCHANTS.find((m) => m.merchantId === byId)?.slug;
      const org = seedSlug
        ? await getMerchantOrgBySlug(this.db, seedSlug)
        : await getMerchantOrgByOnChainMerchantId(this.db, BigInt(byId));
      return this.toMerchantRow(org);
    }
    const org = await getMerchantOrgBySlug(this.db, idOrSlug);
    return this.toMerchantRow(org);
  }

  async listActiveMerchants(): Promise<MerchantRow[]> {
    const orgs = await listActiveMerchantOrgs(this.db);
    const rows = await Promise.all(orgs.map((o) => this.toMerchantRow(o)));
    return rows.filter((r): r is MerchantRow => Boolean(r));
  }

  private async resolveOrgId(merchantId: number): Promise<string> {
    const seed = SEED_MERCHANTS.find((m) => m.merchantId === merchantId);
    if (seed) {
      const org = await getMerchantOrgBySlug(this.db, seed.slug);
      if (!org) throw new Error(`merchant org not found for slug: ${seed.slug}`);
      return org.id;
    }
    const org = await getMerchantOrgByOnChainMerchantId(this.db, BigInt(merchantId));
    if (!org) throw new Error(`unknown merchant_id: ${merchantId}`);
    return org.id;
  }

  async getInventory(merchantId: number, skus?: string[]): Promise<InventoryRow[]> {
    const orgId = await this.resolveOrgId(merchantId);
    const lines = await getMerchantCatalog(this.db, orgId, skus);
    return lines.map((l) => ({
      merchant_id: merchantId,
      sku: l.sku,
      price_micro: l.priceMicroUsdc,
      min_price_micro: l.minPriceMicroUsdc,
      stock_qty: l.availableQty,
    }));
  }

  async getInventoryItem(merchantId: number, sku: string): Promise<InventoryRow | undefined> {
    const [row] = await this.getInventory(merchantId, [sku]);
    return row;
  }

  async getOrgId(merchantId: number): Promise<string | undefined> {
    try {
      return await this.resolveOrgId(merchantId);
    } catch {
      return undefined;
    }
  }

  async reserveStock(
    merchantId: number,
    sku: string,
    qty: number,
    ttlSeconds: number,
  ): Promise<{ reservationId: string; expiresAt: number }> {
    const orgId = await this.resolveOrgId(merchantId);
    try {
      const { reservationId, expiresAt } = await reserveInventoryAtomic(this.db, { merchantId: orgId, sku, qty, ttlSeconds });
      return { reservationId, expiresAt: Math.floor(expiresAt.getTime() / 1000) };
    } catch (err) {
      if (err instanceof InsufficientStockError) throw new Error(`insufficient_stock: ${err.sku}`);
      throw err;
    }
  }

  async commitStockForOrder(merchantId: number, items: { sku: string; qty: number }[]): Promise<void> {
    const orgId = await this.resolveOrgId(merchantId);
    try {
      await pgCommitStockForOrder(this.db, orgId, items);
    } catch (err) {
      if (err instanceof InsufficientStockError) throw new Error(`insufficient_stock: ${err.sku}`);
      throw err;
    }
  }

  async restock(merchantId: number, items: { sku: string; qty: number }[]): Promise<void> {
    const orgId = await this.resolveOrgId(merchantId);
    await restockAfterCancel(this.db, orgId, items);
  }

  async releaseExpiredReservations(): Promise<number> {
    return pgReleaseExpiredReservations(this.db);
  }
}

export function createMerchantStore(db: MerchantDb): MerchantStore {
  return process.env.DATABASE_URL ? new PostgresMerchantStore() : new SqliteMerchantStore(db);
}

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { SEED_MERCHANTS, bytesToHex, hexToBytes } from "@merchantmesh/shared";

export type MerchantDb = DatabaseSync;

export function openDb(path: string): MerchantDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: MerchantDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS merchants (
      merchant_id INTEGER PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      wallet TEXT NOT NULL,
      signer_key TEXT NOT NULL,
      quality_score REAL NOT NULL,
      negotiation_enabled INTEGER NOT NULL,
      max_discount_bps INTEGER NOT NULL,
      reservation_enabled INTEGER NOT NULL,
      reservation_ttl INTEGER NOT NULL,
      pickup INTEGER NOT NULL,
      opening_hours TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      verification_json TEXT NOT NULL,
      agent_id INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inventory (
      merchant_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      price_micro INTEGER NOT NULL,
      min_price_micro INTEGER NOT NULL,
      stock_qty INTEGER NOT NULL,
      PRIMARY KEY (merchant_id, sku)
    );
    CREATE TABLE IF NOT EXISTS quotes (
      quote_id TEXT PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      items_json TEXT NOT NULL,
      total_micro INTEGER NOT NULL,
      valid_until INTEGER NOT NULL,
      nonce INTEGER NOT NULL,
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- active | superseded | expired | consumed
      supersedes TEXT,
      task_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS nonces (
      merchant_id INTEGER PRIMARY KEY,
      next_nonce INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reservations (
      reservation_id TEXT PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      qty INTEGER NOT NULL,
      quote_id TEXT,
      expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'held', -- held | released | consumed
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      merchant_id INTEGER NOT NULL,
      quote_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      buyer TEXT NOT NULL,
      items_json TEXT NOT NULL,
      total_micro INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'quoted',
      pickup_code_hash TEXT NOT NULL,
      escrow_order_id INTEGER,
      escrow_tx TEXT,
      release_tx TEXT,
      release_deadline INTEGER NOT NULL,
      state_log_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments_seen (
      payment_id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL,
      amount_micro INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      refunded INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);
}

/**
 * @param allowEnvOverride Reads MERCHANT_<SLUG>_PRIVATE_KEY (hex-encoded
 *   32-byte Ed25519 seed) from env when true (the real/dev-server default —
 *   see .env.example). Tests MUST pass false: test fixtures hardcode the
 *   deterministic dev wallet addresses, and a real key sitting in a
 *   developer's shell env (e.g. from a real deployment) would silently make
 *   every quote signature mismatch those fixtures.
 *
 * Async — deriving a wallet address from an Ed25519 seed goes through the
 * (Promise-based) Web Crypto API, unlike EVM's synchronous secp256k1 math.
 */
export async function seedDb(db: MerchantDb, allowEnvOverride = true): Promise<void> {
  const count = db.prepare("SELECT COUNT(*) AS c FROM merchants").get() as { c: number };
  if (count.c > 0) {
    db.exec("DELETE FROM merchants; DELETE FROM inventory;");
  }
  const insM = db.prepare(`
    INSERT INTO merchants (merchant_id, slug, name, category, lat, lng, wallet, signer_key,
      quality_score, negotiation_enabled, max_discount_bps, reservation_enabled, reservation_ttl,
      pickup, opening_hours, active, verification_json, agent_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const insI = db.prepare(
    "INSERT INTO inventory (merchant_id, sku, price_micro, min_price_micro, stock_qty) VALUES (?, ?, ?, ?, ?)",
  );
  for (const m of SEED_MERCHANTS) {
    const envOverride = allowEnvOverride ? process.env[m.signerKeyEnv] : undefined;
    const signerSeed = envOverride ? hexToBytes(envOverride) : m.devSignerKey;
    const signerKeyHex = bytesToHex(signerSeed);
    // Wallet is ALWAYS derived from whichever key is actually signing — never
    // the seed's static dev address. If a real MERCHANT_<SLUG>_PRIVATE_KEY is
    // set in env (e.g. .env carries a real deployment's keys even in mock
    // mode), the wallet must match it or every quote signature verification
    // fails silently (wrong signer for the recorded wallet).
    const wallet = (await createKeyPairSignerFromPrivateKeyBytes(signerSeed)).address;
    insM.run(
      m.merchantId, m.slug, m.name, m.category, m.lat, m.lng, wallet, signerKeyHex,
      m.qualityScore, m.negotiation.enabled ? 1 : 0, m.negotiation.maxDiscountBps,
      m.reservation.enabled ? 1 : 0, m.reservation.ttlSeconds,
      m.pickup ? 1 : 0, m.openingHours, JSON.stringify(m.verification), m.agentId,
    );
    for (const item of m.inventory) {
      insI.run(m.merchantId, item.sku, item.priceMicroUsdc, item.minPriceMicroUsdc, item.stockQty);
    }
    db.prepare("INSERT OR REPLACE INTO nonces (merchant_id, next_nonce) VALUES (?, 1)").run(m.merchantId);
  }
}

export interface MerchantRow {
  merchant_id: number;
  slug: string;
  name: string;
  category: string;
  lat: number;
  lng: number;
  wallet: string;
  signer_key: string;
  quality_score: number;
  negotiation_enabled: number;
  max_discount_bps: number;
  reservation_enabled: number;
  reservation_ttl: number;
  pickup: number;
  opening_hours: string;
  active: number;
  verification_json: string;
  agent_id: number;
  /** Faz 3 — only populated for self-service (Postgres) merchants; SEED_MERCHANTS entries leave this undefined. */
  agent_strategy?: string | null;
}

export interface InventoryRow {
  merchant_id: number;
  sku: string;
  price_micro: number;
  min_price_micro: number;
  stock_qty: number;
}

export function getMerchant(db: MerchantDb, idOrSlug: string): MerchantRow | undefined {
  const byId = Number(idOrSlug);
  if (Number.isInteger(byId) && byId > 0) {
    return db.prepare("SELECT * FROM merchants WHERE merchant_id = ?").get(byId) as MerchantRow | undefined;
  }
  return db.prepare("SELECT * FROM merchants WHERE slug = ?").get(idOrSlug) as MerchantRow | undefined;
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

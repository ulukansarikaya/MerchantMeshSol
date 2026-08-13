import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type BridgeDb = DatabaseSync;

export function openDb(path: string): BridgeDb {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

function migrate(db: BridgeDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      task_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      plan_json TEXT,
      discovery_json TEXT,
      options_json TEXT,
      selected_option TEXT,
      receipt_json TEXT,
      error TEXT,
      budget_total_micro INTEGER NOT NULL,
      budget_per_request_micro INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      type TEXT NOT NULL,
      data_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_events ON task_events (task_id, id);
    CREATE TABLE IF NOT EXISTS spend (
      payment_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      amount_micro INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      merchant_slug TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | settled | refunded
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes_seen (
      quote_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      merchant_slug TEXT NOT NULL,
      quote_json TEXT NOT NULL,
      signature_verified INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active', -- active | superseded | consumed | expired
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_orders (
      order_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      merchant_id INTEGER NOT NULL,
      merchant_slug TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      items_json TEXT NOT NULL,
      total_micro INTEGER NOT NULL,
      state TEXT NOT NULL,
      essential INTEGER NOT NULL,
      pickup_code TEXT NOT NULL,
      escrow_order_id INTEGER,
      escrow_tx TEXT,
      release_tx TEXT,
      note TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dropped_shops (
      task_id TEXT NOT NULL,
      merchant_slug TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      items_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      merchant_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      tags_json TEXT NOT NULL,
      tx_ref TEXT,
      created_at INTEGER NOT NULL
    );

    -- ---------------- Mock chain (simulates the three contracts + ERC-8004) --
    CREATE TABLE IF NOT EXISTS chain_wallet (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      address TEXT NOT NULL,
      balance_micro INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chain_escrows (
      escrow_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      merchant_slug TEXT NOT NULL,
      buyer TEXT NOT NULL,
      amount_micro INTEGER NOT NULL,
      quote_hash TEXT NOT NULL,
      pickup_code_hash TEXT NOT NULL,
      funded_at INTEGER NOT NULL,
      release_deadline INTEGER NOT NULL,
      state TEXT NOT NULL DEFAULT 'Funded', -- Funded | Preparing | Ready | Released | Refunded | Disputed
      fund_tx TEXT NOT NULL,
      release_tx TEXT
    );
    CREATE TABLE IF NOT EXISTS chain_receipts (
      receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_ref TEXT NOT NULL,
      total_research_micro INTEGER NOT NULL,
      total_main_micro INTEGER NOT NULL,
      completed_items INTEGER NOT NULL,
      total_items INTEGER NOT NULL,
      metadata_uri TEXT NOT NULL,
      metadata_hash TEXT NOT NULL,
      tx_ref TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chain_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      tags_json TEXT NOT NULL,
      evidence_uri TEXT NOT NULL,
      tx_ref TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

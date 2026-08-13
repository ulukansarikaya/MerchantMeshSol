import { randomUUID } from "node:crypto";
import { canTransition, type OrderState, type QuoteItem } from "@merchantmesh/shared";
import { nowSec, type MerchantDb } from "./db.js";
import type { MerchantStore } from "./store.js";

export interface OrderRow {
  order_id: string;
  merchant_id: number;
  quote_id: string;
  task_id: string;
  buyer: string;
  items_json: string;
  total_micro: number;
  state: OrderState;
  pickup_code_hash: string;
  escrow_order_id: number | null;
  escrow_tx: string | null;
  release_tx: string | null;
  release_deadline: number;
  state_log_json: string;
  created_at: number;
}

/**
 * Creates an order and fast-forwards it through the pre-funding chain
 * (quoted → user_selected → merchant_pending → merchant_confirmed →
 * awaiting_funding) in one shot — this is the mock-mode stand-in for real
 * merchant acceptance, which Faz I replaces with an actual accept/reject UI
 * and a live merchant_pending window. The full log is recorded even though
 * the transition is instantaneous, so the UI/audit trail stays honest.
 */
export function createOrder(
  db: MerchantDb,
  params: {
    merchantId: number;
    quoteId: string;
    taskId: string;
    buyer: string;
    items: QuoteItem[];
    totalMicroUsdc: number;
    pickupCodeHash: string;
    releaseDeadline: number;
  },
): OrderRow {
  const orderId = `o_${randomUUID()}`;
  const ts = nowSec();
  const log = [
    { state: "quoted", ts },
    { state: "user_selected", ts },
    { state: "merchant_pending", ts },
    { state: "merchant_confirmed", ts },
    { state: "awaiting_funding", ts },
  ];
  db.prepare(
    `INSERT INTO orders (order_id, merchant_id, quote_id, task_id, buyer, items_json, total_micro,
       state, pickup_code_hash, release_deadline, state_log_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_funding', ?, ?, ?, ?)`,
  ).run(
    orderId, params.merchantId, params.quoteId, params.taskId, params.buyer,
    JSON.stringify(params.items), params.totalMicroUsdc, params.pickupCodeHash,
    params.releaseDeadline, JSON.stringify(log), ts,
  );
  return getOrder(db, orderId)!;
}

export function getOrder(db: MerchantDb, orderId: string): OrderRow | undefined {
  return db.prepare("SELECT * FROM orders WHERE order_id = ?").get(orderId) as OrderRow | undefined;
}

/** Append-only state log; illegal transitions throw. */
export function transitionOrder(db: MerchantDb, orderId: string, to: OrderState): OrderRow {
  const order = getOrder(db, orderId);
  if (!order) throw new Error(`Order not found: ${orderId}`);
  if (!canTransition(order.state, to)) {
    throw new Error(`Illegal order transition ${order.state} → ${to} (${orderId})`);
  }
  const log = JSON.parse(order.state_log_json) as { state: string; ts: number }[];
  log.push({ state: to, ts: nowSec() });
  db.prepare("UPDATE orders SET state = ?, state_log_json = ? WHERE order_id = ?").run(to, JSON.stringify(log), orderId);
  return getOrder(db, orderId)!;
}

// ---------------------------------------------------------------------------
// Reservations (stock lock with TTL) — routed through MerchantStore so the
// atomicity guarantee (SQLite: single-threaded; Postgres: row-locked UPDATE)
// lives in one place. See apps/merchant-agents/src/store.ts (Faz I §1).
// ---------------------------------------------------------------------------
export interface ReservationRow {
  reservation_id: string;
  merchant_id: number;
  sku: string;
  qty: number;
  quote_id: string | null;
  expires_at: number;
  status: string;
  created_at: number;
}

export async function createReservation(
  store: MerchantStore,
  merchantId: number,
  sku: string,
  qty: number,
  ttlSeconds: number,
  quoteId?: string,
): Promise<ReservationRow> {
  const { reservationId, expiresAt } = await store.reserveStock(merchantId, sku, qty, ttlSeconds);
  return {
    reservation_id: reservationId,
    merchant_id: merchantId,
    sku,
    qty,
    quote_id: quoteId ?? null,
    expires_at: expiresAt,
    status: "held",
    created_at: nowSec(),
  };
}

/** Consume held reservations covering an order's items; decrement stock for the rest. */
export async function commitStockForOrder(store: MerchantStore, merchantId: number, items: QuoteItem[]): Promise<void> {
  await store.commitStockForOrder(
    merchantId,
    items.map((i) => ({ sku: i.sku, qty: i.qty })),
  );
}

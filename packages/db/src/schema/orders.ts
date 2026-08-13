import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./core.js";
import { agents } from "./agentic.js";
import { merchantOrganizations } from "./market.js";

// ---------------------------------------------------------------------------
// Shopping tasks (the live-version successor of the bridge's SQLite `tasks`)
// ---------------------------------------------------------------------------
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    status: text("status").notNull().default("planning"),
    lat: text("lat"),
    lng: text("lng"),
    planJson: jsonb("plan_json"),
    optionsJson: jsonb("options_json"),
    selectedOption: text("selected_option"),
    receiptJson: jsonb("receipt_json"),
    error: text("error"),
    budgetTotalMicro: bigint("budget_total_micro", { mode: "bigint" }).notNull(),
    budgetPerRequestMicro: bigint("budget_per_request_micro", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_account_id_idx").on(t.accountId)],
);

export const quotesSeen = pgTable("quotes_seen", {
  quoteId: text("quote_id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchantOrganizations.id),
  quoteJson: jsonb("quote_json").notNull(),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  status: text("status").notNull().default("active"), // active | superseded | consumed | expired
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Faz I — merchant acceptance window, precedes escrow funding. */
export const merchantAcceptances = pgTable(
  "merchant_acceptances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id),
    status: text("status").notNull().default("pending"), // pending | accepted | rejected | expired
    reason: text("reason"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("merchant_acceptances_task_id_idx").on(t.taskId)],
);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    inventoryId: uuid("inventory_id").notNull(),
    quoteId: text("quote_id").references(() => quotesSeen.quoteId),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull().default("held"), // held | consumed | released
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservations_inventory_id_idx").on(t.inventoryId)],
);

// ---------------------------------------------------------------------------
// Per-shop order + escrow (v2 state machine — see plans/faz-0.md §1)
// ---------------------------------------------------------------------------
export const taskOrders = pgTable(
  "task_orders",
  {
    id: text("id").primaryKey(), // matches merchant-agents' `o_<uuid>` convention
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id),
    quoteId: text("quote_id").references(() => quotesSeen.quoteId),
    itemsJson: jsonb("items_json").notNull(),
    totalMicroUsdc: bigint("total_micro_usdc", { mode: "bigint" }).notNull(),
    state: text("state").notNull().default("quoted"),
    essential: boolean("essential").notNull().default(false),
    pickupCodeHash: text("pickup_code_hash"),
    escrowId: uuid("escrow_id"),
    note: text("note"),
    stateLogJson: jsonb("state_log_json").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_orders_task_id_idx").on(t.taskId)],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskOrderId: text("task_order_id")
    .notNull()
    .references(() => taskOrders.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  qty: integer("qty").notNull(),
  unitPriceMicroUsdc: bigint("unit_price_micro_usdc", { mode: "bigint" }).notNull(),
});

export const escrows = pgTable("escrows", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskOrderId: text("task_order_id")
    .notNull()
    .unique()
    .references(() => taskOrders.id, { onDelete: "cascade" }),
  chainId: integer("chain_id").notNull(),
  escrowOrderId: bigint("escrow_order_id", { mode: "bigint" }), // on-chain OrderEscrow.orderId, set once funded
  buyerAddress: text("buyer_address").notNull(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchantOrganizations.id),
  amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
  quoteHash: text("quote_hash").notNull(),
  pickupCodeHash: text("pickup_code_hash").notNull(),
  releaseDeadline: timestamp("release_deadline", { withTimezone: true }).notNull(),
  state: text("state").notNull().default("awaiting_funding"), // mirrors OrderEscrow.OrderState
  fundTxHash: text("fund_tx_hash"),
  releaseTxHash: text("release_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Payment ledger (Faz J — x402 v2 tx-proof based)
// ---------------------------------------------------------------------------
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id").references(() => merchantOrganizations.id),
    taskId: text("task_id").references(() => tasks.id),
    orderId: text("order_id").references(() => taskOrders.id),
    escrowId: uuid("escrow_id").references(() => escrows.id),
    eventType: text("event_type").notNull(), // research_fee | escrow_fund | escrow_release | escrow_refund | fee_refund
    direction: text("direction").notNull(), // debit | credit
    amountMicroUsdc: bigint("amount_micro_usdc", { mode: "bigint" }).notNull(),
    status: text("status").notNull().default("pending"), // pending | confirmed | failed
    chainId: integer("chain_id"),
    tokenAddress: text("token_address"),
    fromAddress: text("from_address"),
    toAddress: text("to_address"),
    txHash: text("tx_hash"),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    transactionIndex: integer("transaction_index"),
    logIndex: integer("log_index"),
    confirmations: integer("confirmations").notNull().default(0),
    idempotencyKey: text("idempotency_key"),
    relatedPaymentEventId: uuid("related_payment_event_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("payment_events_chain_tx_log_idx").on(t.chainId, t.txHash, t.logIndex),
    index("payment_events_account_id_idx").on(t.accountId),
  ],
);

/** x402 replay protection — a settled tx hash may fund exactly one paid request. */
export const paymentProofs = pgTable(
  "payment_proofs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    txHash: text("tx_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("payment_proofs_chain_tx_idx").on(t.chainId, t.txHash)],
);

export const receipts = pgTable("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: text("task_id")
    .notNull()
    .unique()
    .references(() => tasks.id, { onDelete: "cascade" }),
  totalResearchMicroUsdc: bigint("total_research_micro_usdc", { mode: "bigint" }).notNull(),
  totalMainMicroUsdc: bigint("total_main_micro_usdc", { mode: "bigint" }).notNull(),
  completedItems: integer("completed_items").notNull(),
  totalItems: integer("total_items").notNull(),
  completedShops: integer("completed_shops").notNull(),
  totalShops: integer("total_shops").notNull(),
  shopsJson: jsonb("shops_json").notNull(),
  metadataUri: text("metadata_uri").notNull(),
  metadataHash: text("metadata_hash").notNull(),
  receiptTxHash: text("receipt_tx_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    orderId: text("order_id").references(() => taskOrders.id),
    type: text("type").notNull(), // missing_item | wrong_item | quality_issue | payment_issue | partial_refund_request
    description: text("description").notNull(),
    photoObjectKeys: jsonb("photo_object_keys").notNull().default([]),
    status: text("status").notNull().default("open"), // open | resolved | rejected
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("support_tickets_account_id_idx").on(t.accountId)],
);

/**
 * Manual dispute log (minimal Faz 5 slice — no stake/slashing). Resolving to
 * refunded/released is expected to call the already-deployed order_escrow
 * `resolve` instruction (arbiter-gated, same relayer key as everything else
 * on-chain) — this table only tracks the off-chain review workflow around it.
 */
export const disputes = pgTable(
  "disputes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskOrderId: text("task_order_id")
      .notNull()
      .references(() => taskOrders.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id),
    raisedByAccountId: uuid("raised_by_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"), // open | reviewing | refunded | released | closed
    reason: text("reason").notNull(),
    resolution: text("resolution"),
    resolvedByAccountId: uuid("resolved_by_account_id").references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("disputes_task_order_id_idx").on(t.taskOrderId), index("disputes_merchant_id_idx").on(t.merchantId)],
);

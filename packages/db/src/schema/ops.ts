import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id"),
    action: text("action").notNull(), // e.g. "auth.login", "session_wallet.sign", "escrow.refund"
    detailJson: jsonb("detail_json").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("audit_logs_id_idx").on(t.id)],
);

/** Outbox pattern (Faz L) — reliable side-effects (notifications, webhooks) after a commit. */
export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic").notNull(),
  payloadJson: jsonb("payload_json").notNull(),
  status: text("status").notNull().default("pending"), // pending | sent | failed
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const jobRuns = pgTable("job_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobName: text("job_name").notNull(),
  status: text("status").notNull().default("running"), // running | succeeded | failed
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  resultJson: jsonb("result_json"),
});

/** Faz L — chain event indexer watermark, one row per (chainId, topic). */
export const chainCursors = pgTable(
  "chain_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chainId: integer("chain_id").notNull(),
    topic: text("topic").notNull(), // e.g. "OrderEscrow.OrderFunded"
    lastBlockNumber: text("last_block_number").notNull().default("0"), // bigint-as-text (JS-safe)
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("chain_cursors_chain_topic_idx").on(t.chainId, t.topic)],
);

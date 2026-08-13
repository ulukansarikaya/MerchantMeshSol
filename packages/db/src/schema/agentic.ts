import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./core.js";
import { vector } from "../types.js";

// ---------------------------------------------------------------------------
// Agents (Faz C — one logical agent per account, not a running model instance)
// ---------------------------------------------------------------------------
export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Kişisel Agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentProfiles = pgTable("agent_profiles", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),
  prefsJson: jsonb("prefs_json").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agent memory (Faz G) — structured + episodic, embedding via pgvector
// ---------------------------------------------------------------------------
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    memoryType: text("memory_type").notNull(), // structured_preference | episodic
    content: text("content").notNull(),
    structuredKey: text("structured_key"),
    structuredValueJson: jsonb("structured_value_json"),
    confidence: real("confidence").notNull().default(1),
    sourceConversationId: uuid("source_conversation_id"),
    sourceMessageId: uuid("source_message_id"),
    sourceOrderId: text("source_order_id"),
    userConfirmed: boolean("user_confirmed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("agent_memories_agent_id_idx").on(t.agentId)],
);

// ---------------------------------------------------------------------------
// Conversations + messages (Faz C starts writing here; Faz K builds the UI)
// ---------------------------------------------------------------------------
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    walletAddress: text("wallet_address"),
    title: text("title"),
    status: text("status").notNull().default("active"), // active | archived
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversations_account_id_idx").on(t.accountId)],
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | system_event | tool_event | merchant_quote | payment_event | order_event
    content: text("content").notNull(),
    messageType: text("message_type").notNull().default("user"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("conversation_messages_conversation_id_idx").on(t.conversationId)],
);

export const savedPrompts = pgTable("saved_prompts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shoppingTemplates = pgTable("shopping_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  servings: integer("servings"),
  maxResearchBudgetMicro: bigint("max_research_budget_micro", { mode: "bigint" }),
  deliveryMode: text("delivery_mode").notNull().default("pickup"), // pickup | walking
  itemsJson: jsonb("items_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

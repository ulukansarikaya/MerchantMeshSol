import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Accounts, wallets, sessions (Faz C — SIWE auth)
// ---------------------------------------------------------------------------
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("active"), // active | frozen
  activeMode: text("active_mode").notNull().default("customer"), // customer | merchant
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wallets = pgTable(
  "wallets",
  {
    address: text("address").primaryKey(), // lowercase 0x…
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("wallets_account_id_idx").on(t.accountId)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(), // sha256(token) — never the raw token
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  walletAddress: text("wallet_address")
    .notNull()
    .references(() => wallets.address, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  userAgentHash: text("user_agent_hash"),
});

/** SIWE nonces — single-use, short TTL; row deleted (or marked used) on verify. */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const userProfiles = pgTable("user_profiles", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Location preferences (Faz H)
// ---------------------------------------------------------------------------
export const locationPreferences = pgTable("location_preferences", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  maxWalkingDistanceM: integer("max_walking_distance_m").notNull().default(1000),
  maxWalkingDurationMin: integer("max_walking_duration_min").notNull().default(15),
  defaultSearchRadiusM: integer("default_search_radius_m").notNull().default(1500),
  allowMultiStopRoute: boolean("allow_multi_stop_route").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Session wallet (Faz J — pilot, testnet-only micropayment signer)
// ---------------------------------------------------------------------------
export const sessionWallets = pgTable("session_wallets", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  address: text("address").notNull().unique(),
  encryptedKey: text("encrypted_key").notNull(), // AES-256-GCM envelope (base64: iv+tag+ciphertext)
  dailySpentMicro: bigint("daily_spent_micro", { mode: "bigint" }).notNull().default(sql`0`),
  dailySpentResetAt: timestamp("daily_spent_reset_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
});

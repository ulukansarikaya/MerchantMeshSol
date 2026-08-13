import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./core.js";
import { geographyPoint } from "../types.js";

// ---------------------------------------------------------------------------
// Merchant organization (Faz D) — a merchant is an org, not a bare wallet
// ---------------------------------------------------------------------------
export const merchantOrganizations = pgTable("merchant_organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(), // butcher | greengrocer | bakery | market
  qualityScore: real("quality_score").notNull().default(0),
  active: boolean("active").notNull().default(true),
  erc8004AgentId: integer("erc8004_agent_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  // ---- Faz 2 (self-service agent lifecycle) ----
  status: text("status").notNull().default("draft"), // draft | pending_review | active | suspended | archived
  runtime: text("runtime").notNull().default("hosted"), // hosted | external
  endpointUri: text("endpoint_uri"),
  serviceRadiusM: integer("service_radius_m"),
  agentStrategy: text("agent_strategy"), // balanced | aggressive | conservative
  pricingPolicyVersion: text("pricing_policy_version").notNull().default("pricing-v1"),
  manifestHash: text("manifest_hash"),
  /** u64 merchant_id on merchant_directory/order_escrow — set only once an operator publishes this org on-chain. */
  onChainMerchantId: bigint("on_chain_merchant_id", { mode: "bigint" }),
  /** AES-256-GCM envelope (packages/shared/sessionWalletCrypto.ts), same scheme as customer session wallets —
   *  self-service merchants don't have a devSignerKey/env-var signer the way SEED_MERCHANTS entries do. */
  encryptedSignerKey: text("encrypted_signer_key"),
});

/** MVP: Owner role only; table shape already supports Manager/Inventory Manager/etc. */
export const merchantMembers = pgTable(
  "merchant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // owner | manager | inventory_manager | order_operator | finance_viewer
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_members_merchant_account_idx").on(t.merchantId, t.accountId)],
);

export const merchantWallets = pgTable(
  "merchant_wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    isPayout: boolean("is_payout").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("merchant_wallets_address_idx").on(t.address)],
);

export const merchantSettings = pgTable("merchant_settings", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
  negotiationEnabled: boolean("negotiation_enabled").notNull().default(false),
  maxDiscountBps: integer("max_discount_bps").notNull().default(0),
  autoReserve: boolean("auto_reserve").notNull().default(true),
  reservationTtlSec: integer("reservation_ttl_sec").notNull().default(600),
  maxDailyReservations: integer("max_daily_reservations").notNull().default(100),
  offerWhenLowStock: boolean("offer_when_low_stock").notNull().default(false),
  prepTimeMin: integer("prep_time_min").notNull().default(15),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merchantLocations = pgTable("merchant_locations", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
  address: text("address"),
  location: geographyPoint("location").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const merchantHours = pgTable(
  "merchant_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    weekday: integer("weekday").notNull(), // 0=Sun … 6=Sat
    opensAt: text("opens_at").notNull(), // "08:00"
    closesAt: text("closes_at").notNull(), // "20:00"
  },
  (t) => [uniqueIndex("merchant_hours_merchant_weekday_idx").on(t.merchantId, t.weekday)],
);

// ---------------------------------------------------------------------------
// Catalog, warehouses, inventory (Faz E)
// ---------------------------------------------------------------------------
/** Canonical SKU catalog — mirrors packages/shared's CANONICAL_SKUS. */
export const products = pgTable("products", {
  sku: text("sku").primaryKey(),
  nameTr: text("name_tr").notNull(),
  nameEn: text("name_en").notNull(),
  category: text("category").notNull(),
  unit: text("unit").notNull(),
  essential: boolean("essential").notNull().default(false),
});

export const merchantProducts = pgTable(
  "merchant_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    canonicalSku: text("canonical_sku")
      .notNull()
      .references(() => products.sku),
    merchantProductName: text("merchant_product_name").notNull(),
    description: text("description"),
    unitType: text("unit_type").notNull(),
    unitSize: text("unit_size"),
    basePriceMicroUsdc: bigint("base_price_micro_usdc", { mode: "bigint" }).notNull(),
    minimumPriceMicroUsdc: bigint("minimum_price_micro_usdc", { mode: "bigint" }).notNull(),
    costMicroUsdc: bigint("cost_micro_usdc", { mode: "bigint" }),
    /** Explicit margin floor, distinct from costMicroUsdc — pricingPolicy.ts floors at max(minimumPriceMicroUsdc, this). */
    minMarginMicroUsdc: bigint("min_margin_micro_usdc", { mode: "bigint" }),
    /** Per-SKU override of merchantSettings.maxDiscountBps; null = inherit the merchant-wide cap. */
    maxDiscountBps: integer("max_discount_bps"),
    lowStockBehavior: text("low_stock_behavior").notNull().default("hold"), // block | discount_off | hold
    qualityScore: real("quality_score").notNull().default(0),
    active: boolean("active").notNull().default(true),
    imageObjectKey: text("image_object_key"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("merchant_products_merchant_sku_idx").on(t.merchantId, t.canonicalSku),
    check("merchant_products_price_check", sql`${t.basePriceMicroUsdc} >= ${t.minimumPriceMicroUsdc}`),
  ],
);

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Ana Depo"),
  address: text("address"),
  location: geographyPoint("location"),
  active: boolean("active").notNull().default(true),
});

export const inventory = pgTable(
  "inventory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    merchantProductId: uuid("merchant_product_id")
      .notNull()
      .references(() => merchantProducts.id, { onDelete: "cascade" }),
    physicalQuantity: integer("physical_quantity").notNull().default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    availableQuantity: integer("available_quantity").notNull().default(0),
    lowStockThreshold: integer("low_stock_threshold").notNull().default(2),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_warehouse_product_idx").on(t.warehouseId, t.merchantProductId),
    check("inventory_available_nonneg_check", sql`${t.availableQuantity} >= 0`),
    check("inventory_reserved_nonneg_check", sql`${t.reservedQuantity} >= 0`),
    check(
      "inventory_available_eq_physical_minus_reserved_check",
      sql`${t.availableQuantity} = ${t.physicalQuantity} - ${t.reservedQuantity}`,
    ),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inventoryId: uuid("inventory_id")
      .notNull()
      .references(() => inventory.id, { onDelete: "cascade" }),
    movementType: text("movement_type").notNull(), // stock_in | sale | reserve | reservation_release | manual_adjustment | waste | return
    quantityDelta: integer("quantity_delta").notNull(),
    sourceType: text("source_type"), // order | reservation | manual
    sourceId: text("source_id"),
    note: text("note"),
    actorAccountId: uuid("actor_account_id").references(() => accounts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("inventory_movements_inventory_id_idx").on(t.inventoryId)],
);

// ---------------------------------------------------------------------------
// Campaigns (Faz F) — deterministic rule engine, LLM never sets the discount
// ---------------------------------------------------------------------------
export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: uuid("merchant_id")
    .notNull()
    .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | active | paused | expired
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  totalUsageLimit: integer("total_usage_limit"),
  perAccountUsageLimit: integer("per_account_usage_limit"),
  stackPolicy: text("stack_policy").notNull().default("exclusive"), // exclusive | stackable
  priority: integer("priority").notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const campaignRules = pgTable("campaign_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id")
    .notNull()
    .references(() => campaigns.id, { onDelete: "cascade" }),
  ruleType: text("rule_type").notNull(), // percent_off | fixed_off | bogo | bundle | min_basket | time_window | loyalty | first_order
  ruleJson: jsonb("rule_json").notNull().default({}),
  discountType: text("discount_type").notNull(), // percent | fixed
  discountValue: bigint("discount_value", { mode: "bigint" }).notNull(), // bps if percent, micro-USDC if fixed
  maximumDiscountMicroUsdc: bigint("maximum_discount_micro_usdc", { mode: "bigint" }),
});

export const campaignUsage = pgTable(
  "campaign_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull(),
    discountMicroUsdc: bigint("discount_micro_usdc", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaign_usage_campaign_account_order_idx").on(t.campaignId, t.accountId, t.orderId)],
);

// ---------------------------------------------------------------------------
// Pricing decisions (Faz 3) — audit log for every LLM-assisted discount
// decision, whether or not the LLM path actually ran (fallbackUsed=true when
// it didn't). The LLM's raw output (llmOutputJson) is stored for review, but
// discountMicroUsdc/finalTotalMicroUsdc are always the deterministic,
// policy-clamped numbers — see AGENTS.md's "Ödeme Akışı" section.
// ---------------------------------------------------------------------------
export const pricingDecisions = pgTable(
  "pricing_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchantOrganizations.id, { onDelete: "cascade" }),
    quoteId: text("quote_id"),
    inputHash: text("input_hash").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    llmOutputJson: jsonb("llm_output_json"),
    appliedRulesJson: jsonb("applied_rules_json").notNull().default([]),
    baseTotalMicroUsdc: bigint("base_total_micro_usdc", { mode: "bigint" }).notNull(),
    discountMicroUsdc: bigint("discount_micro_usdc", { mode: "bigint" }).notNull().default(sql`0`),
    finalTotalMicroUsdc: bigint("final_total_micro_usdc", { mode: "bigint" }).notNull(),
    validUntil: integer("valid_until"), // unix seconds, matches Quote.validUntil
    merchantSignature: text("merchant_signature"),
    fallbackUsed: boolean("fallback_used").notNull().default(false),
    fallbackReason: text("fallback_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pricing_decisions_merchant_id_idx").on(t.merchantId)],
);

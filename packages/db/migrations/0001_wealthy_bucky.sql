CREATE TABLE IF NOT EXISTS "pricing_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"merchant_id" uuid NOT NULL,
	"quote_id" text,
	"input_hash" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"llm_output_json" jsonb,
	"applied_rules_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"base_total_micro_usdc" bigint NOT NULL,
	"discount_micro_usdc" bigint DEFAULT 0 NOT NULL,
	"final_total_micro_usdc" bigint NOT NULL,
	"valid_until" integer,
	"merchant_signature" text,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"fallback_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_order_id" text NOT NULL,
	"merchant_id" uuid NOT NULL,
	"raised_by_account_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reason" text NOT NULL,
	"resolution" text,
	"resolved_by_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "runtime" text DEFAULT 'hosted' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "endpoint_uri" text;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "service_radius_m" integer;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "agent_strategy" text;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "pricing_policy_version" text DEFAULT 'pricing-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "manifest_hash" text;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "on_chain_merchant_id" bigint;--> statement-breakpoint
ALTER TABLE "merchant_organizations" ADD COLUMN "encrypted_signer_key" text;--> statement-breakpoint
ALTER TABLE "merchant_products" ADD COLUMN "min_margin_micro_usdc" bigint;--> statement-breakpoint
ALTER TABLE "merchant_products" ADD COLUMN "max_discount_bps" integer;--> statement-breakpoint
ALTER TABLE "merchant_products" ADD COLUMN "low_stock_behavior" text DEFAULT 'hold' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricing_decisions" ADD CONSTRAINT "pricing_decisions_merchant_id_merchant_organizations_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant_organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_task_order_id_task_orders_id_fk" FOREIGN KEY ("task_order_id") REFERENCES "public"."task_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_merchant_id_merchant_organizations_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchant_organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_raised_by_account_id_accounts_id_fk" FOREIGN KEY ("raised_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "disputes" ADD CONSTRAINT "disputes_resolved_by_account_id_accounts_id_fk" FOREIGN KEY ("resolved_by_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricing_decisions_merchant_id_idx" ON "pricing_decisions" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_task_order_id_idx" ON "disputes" USING btree ("task_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_merchant_id_idx" ON "disputes" USING btree ("merchant_id");--> statement-breakpoint
-- Manual backfill: rows that existed before this migration (the 5 SEED_MERCHANTS orgs from
-- scripts/seed-pg.ts) are already-live merchants, not new self-service drafts — the column
-- default above ('draft') is only correct for genuinely new inserts going forward.
UPDATE "merchant_organizations" SET "status" = 'active' WHERE "active" = true;
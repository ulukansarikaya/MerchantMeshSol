import { z } from "zod";
import { MerchantCategory, SKU_IDS } from "./skus.js";

export const SkuId = z.enum(SKU_IDS);
export type SkuId = z.infer<typeof SkuId>;

const microUsdc = z.number().int().nonnegative();
/** Base58-encoded Solana address (32-byte Ed25519 public key or PDA). */
export const SolanaAddress = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
/** Base58-encoded Ed25519 signature (64 raw bytes; base58 length varies with leading zero bytes). */
export const SolanaSignature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{60,90}$/);

// ---------------------------------------------------------------------------
// Planning (LLM output — SKUs and quantities only, never prices)
// ---------------------------------------------------------------------------
export const PlanItem = z.object({
  sku: SkuId,
  qty: z.number().int().positive().max(50),
  essential: z.boolean(),
});
export type PlanItem = z.infer<typeof PlanItem>;

export const ShoppingPlan = z.object({
  items: z.array(PlanItem).min(1).max(20),
  servings: z.number().int().positive().optional(),
  explanation: z.string(),
});
export type ShoppingPlan = z.infer<typeof ShoppingPlan>;

// ---------------------------------------------------------------------------
// Faz 3 — merchant-side LLM discount proposal. `proposedDiscountBps` is
// NEVER the final discount — apps/merchant-agents/src/pricingPolicy.ts always
// clamps it against merchant.maxDiscountBps and each line's min price before
// it touches a quote. `max(2000)` here is a hard sanity ceiling independent
// of any merchant's own cap, so a misbehaving response can't get close to
// authority. See AGENTS.md's "Ödeme Akışı" section.
// ---------------------------------------------------------------------------
export const SelectedVariant = z.object({
  requestedSku: SkuId,
  offeredSku: SkuId,
  reason: z.string(),
});
export type SelectedVariant = z.infer<typeof SelectedVariant>;

export const MerchantDecision = z.object({
  selectedVariants: z.array(SelectedVariant).optional(),
  proposedDiscountBps: z.number().int().min(0).max(2000),
  estimatedPrepMinutes: z.number().int().positive().optional(),
  rationale: z.string(),
});
export type MerchantDecision = z.infer<typeof MerchantDecision>;

// ---------------------------------------------------------------------------
// Merchants / discovery
// ---------------------------------------------------------------------------
export const VerificationFlags = z.object({
  identity: z.boolean(),
  attestation: z.boolean(),
  stake: z.boolean(),
});
export type VerificationFlags = z.infer<typeof VerificationFlags>;

export const MerchantPublic = z.object({
  merchantId: z.number().int().positive(),
  slug: z.string(),
  name: z.string(),
  category: MerchantCategory,
  lat: z.number(),
  lng: z.number(),
  distanceM: z.number().int().nonnegative().optional(),
  wallet: SolanaAddress,
  qualityScore: z.number().min(0).max(10),
  negotiation: z.boolean(),
  reservation: z.boolean(),
  pickup: z.boolean(),
  active: z.boolean(),
  openingHours: z.string(),
  verification: VerificationFlags,
  /** Pointer into an external agent identity registry, if one is ever wired up — not verified identity on its own. */
  agentId: z.number().int().nonnegative(),
});
export type MerchantPublic = z.infer<typeof MerchantPublic>;

export const DiscoveryQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50_000).default(1_000),
});

// ---------------------------------------------------------------------------
// Quotes (Ed25519-signed by the merchant signer key — see quoteSignature.ts)
// ---------------------------------------------------------------------------
export const QuoteItem = z.object({
  sku: SkuId,
  qty: z.number().int().positive(),
  unitPriceMicroUsdc: microUsdc,
});
export type QuoteItem = z.infer<typeof QuoteItem>;

export const Quote = z.object({
  quoteId: z.string().min(8),
  merchantId: z.number().int().positive(),
  merchantWallet: SolanaAddress,
  items: z.array(QuoteItem).min(1),
  totalMicroUsdc: microUsdc,
  validUntil: z.number().int(), // unix seconds
  nonce: z.number().int().nonnegative(),
});
export type Quote = z.infer<typeof Quote>;

export const SignedQuote = Quote.extend({
  signature: SolanaSignature,
});
export type SignedQuote = z.infer<typeof SignedQuote>;

export const QUOTE_VALIDITY_SECONDS = 300;

// ---------------------------------------------------------------------------
// x402 payment handshake (v2 — tx-proof based, see plans/faz-0.md §4)
// ---------------------------------------------------------------------------
export const PaymentRequirements = z.object({
  scheme: z.string(), // "spl-transfer" (real) or "mock-hmac" (mock/test path)
  network: z.string(), // Solana cluster name, e.g. "devnet" — env-driven, never hardcoded (see solanaConfig.ts)
  asset: z.string(), // SPL mint address in real mode; symbol placeholder in mock
  amountMicroUsdc: microUsdc,
  payTo: SolanaAddress,
  endpoint: z.string(),
  reason: z.string(),
  idempotencyKey: z.string(),
  expiresAt: z.number().int(), // unix seconds
});
export type PaymentRequirements = z.infer<typeof PaymentRequirements>;

/** Real-mode payment proof: an on-chain SPL transfer transaction signature. */
export const PaymentProofTx = z.object({
  kind: z.literal("tx"),
  txSignature: SolanaSignature,
  from: SolanaAddress,
  idempotencyKey: z.string(),
});
export type PaymentProofTx = z.infer<typeof PaymentProofTx>;

/** Mock-mode payment proof: HMAC-signed by the payer, verified locally by the merchant. */
export const MockPaymentProof = z.object({
  paymentId: z.string(),
  taskId: z.string(),
  amountMicroUsdc: microUsdc,
  payTo: SolanaAddress,
  endpoint: z.string(),
  idempotencyKey: z.string(),
  issuedAt: z.number().int(),
  provider: z.enum(["mock", "x402"]),
  sig: z.string(),
});
export type MockPaymentProof = z.infer<typeof MockPaymentProof>;

// ---------------------------------------------------------------------------
// Order state machine (v2 — see plans/faz-0.md §1)
//
// Escrow is funded only after merchant_confirmed, and only from the buyer's
// own wallet — the backbone invariant of the live version. The pre-funding
// chain (user_selected → merchant_pending → merchant_confirmed →
// awaiting_funding) replaces the old reserved/approved pair.
// ---------------------------------------------------------------------------
export const OrderState = z.enum([
  "quoted",
  "user_selected",
  "merchant_pending",
  "merchant_confirmed",
  "merchant_rejected",
  "awaiting_funding",
  "paid_in_escrow",
  "preparing",
  "ready",
  "completed",
  "expired",
  "refunded",
  "cancelled",
  "disputed",
]);
export type OrderState = z.infer<typeof OrderState>;

/** Legal transitions; every transition is appended to stateLog + emitted on SSE. */
export const ORDER_TRANSITIONS: Record<OrderState, OrderState[]> = {
  quoted: ["user_selected", "expired", "cancelled"],
  user_selected: ["merchant_pending", "cancelled"],
  merchant_pending: ["merchant_confirmed", "merchant_rejected", "expired", "cancelled"],
  merchant_confirmed: ["awaiting_funding"],
  awaiting_funding: ["paid_in_escrow", "cancelled"],
  paid_in_escrow: ["preparing", "refunded", "cancelled", "disputed"],
  preparing: ["ready", "refunded", "disputed"],
  ready: ["completed", "refunded", "disputed"],
  completed: [],
  expired: [],
  refunded: [],
  cancelled: [],
  merchant_rejected: [],
  disputed: ["completed", "refunded"],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Options presented to the user
// ---------------------------------------------------------------------------
export const OptionKind = z.enum(["cheapest", "best_quality", "pickup_optimized"]);
export type OptionKind = z.infer<typeof OptionKind>;

export const OptionShop = z.object({
  merchantId: z.number().int().positive(),
  merchantSlug: z.string(),
  merchantName: z.string(),
  quoteId: z.string(),
  items: z.array(QuoteItem),
  subtotalMicroUsdc: microUsdc,
  distanceM: z.number().int().nonnegative(),
  essential: z.boolean(), // shop carries at least one essential item
});
export type OptionShop = z.infer<typeof OptionShop>;

export const ShoppingOption = z.object({
  kind: OptionKind,
  label: z.string(),
  shops: z.array(OptionShop).min(1),
  totalMicroUsdc: microUsdc,
  totalWalkM: z.number().int().nonnegative(),
  stops: z.number().int().positive(),
  avgQuality: z.number(),
  note: z.string(),
});
export type ShoppingOption = z.infer<typeof ShoppingOption>;

// ---------------------------------------------------------------------------
// Task events (SSE timeline)
// ---------------------------------------------------------------------------
export const TaskEvent = z.object({
  seq: z.number().int(),
  taskId: z.string(),
  ts: z.number().int(),
  type: z.string(),
  data: z.record(z.unknown()),
});
export type TaskEvent = z.infer<typeof TaskEvent>;

export const TaskStatus = z.enum([
  "planning",
  "awaiting_list_approval",
  "discovering",
  "quoting",
  "researching",
  "options_ready",
  "awaiting_approval",
  "funding", // mock path only — jumps straight to escrow; Postgres path uses awaiting_merchant/awaiting_funding instead
  "awaiting_merchant", // Faz I — waiting on merchant_pending acceptances (Postgres path)
  "awaiting_funding", // Faz I — every shop merchant_confirmed; escrow rows created, waiting on the user's wallet
  "in_progress",
  "settled",
  "failed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

// ---------------------------------------------------------------------------
// Receipt
// ---------------------------------------------------------------------------
export const ReceiptShop = z.object({
  merchantSlug: z.string(),
  merchantName: z.string(),
  status: z.enum(["completed", "dropped", "refunded"]),
  amountMicroUsdc: microUsdc,
  items: z.array(QuoteItem),
  pickupCode: z.string().optional(),
  escrowTx: z.string().optional(),
  releaseTx: z.string().optional(),
  note: z.string().optional(),
});
export type ReceiptShop = z.infer<typeof ReceiptShop>;

export const Receipt = z.object({
  receiptId: z.string(),
  taskRef: z.string(),
  totalResearchMicroUsdc: microUsdc,
  totalMainMicroUsdc: microUsdc,
  completedItems: z.number().int().nonnegative(),
  totalItems: z.number().int().nonnegative(),
  completedShops: z.number().int().nonnegative(),
  totalShops: z.number().int().nonnegative(),
  shops: z.array(ReceiptShop),
  metadataURI: z.string(),
  metadataHash: z.string(),
  receiptTx: z.string().optional(),
  createdAt: z.number().int(),
});
export type Receipt = z.infer<typeof Receipt>;

// ---------------------------------------------------------------------------
// Feedback → reputation adapter
// ---------------------------------------------------------------------------
export const Feedback = z.object({
  merchantId: z.number().int().positive(),
  score: z.number().int().min(1).max(5),
  tags: z.array(z.string()).max(5),
  comment: z.string().max(280).optional(),
});
export type Feedback = z.infer<typeof Feedback>;

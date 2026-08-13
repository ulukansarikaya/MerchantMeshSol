import type { Address, Instruction } from "@solana/kit";
import { buildInstruction } from "./idlCodec.js";
import { ORDER_ESCROW_IDL, ORDER_RECEIPT_IDL } from "./idl.js";
import { ORDER_ESCROW_PROGRAM_ID, ORDER_RECEIPT_PROGRAM_ID } from "./programIds.js";

/**
 * Typed wrappers over {@link buildInstruction} for the instructions the apps
 * actually call (fund/mark_preparing/mark_ready/confirm_pickup/refund/
 * user_release/create_receipt) — the Solana analog of viem's
 * `writeContract({ abi: ORDER_ESCROW_ABI, functionName: "fund", args: [...] })`
 * call sites. `dispute`/`resolve`/`set_merchant_wallet`/`list_merchant`/
 * `set_active`/`initialize` are deploy-time or admin-console operations, not
 * used by these apps yet, so they don't have wrappers here — call
 * `buildInstruction` directly with the relevant IDL if/when they're needed.
 */

type OrderId = bigint | number;

// ---------------------------------------------------------------------------
// order_escrow
// ---------------------------------------------------------------------------
export interface FundAccounts {
  buyer: Address;
  escrowConfig: Address;
  merchantWallet: Address;
  order: Address;
  usdcMint: Address;
  vault: Address;
  buyerTokenAccount: Address;
}
export interface FundArgs {
  orderId: OrderId;
  amount: bigint | number;
  quoteHash: Uint8Array;
  pickupCodeHash: Uint8Array;
  releaseDeadline: bigint | number;
}
export function buildFundInstruction(accounts: FundAccounts, args: FundArgs): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "fund",
    {
      buyer: accounts.buyer,
      escrow_config: accounts.escrowConfig,
      merchant_wallet: accounts.merchantWallet,
      order: accounts.order,
      usdc_mint: accounts.usdcMint,
      vault: accounts.vault,
      buyer_token_account: accounts.buyerTokenAccount,
    },
    {
      order_id: args.orderId,
      amount: args.amount,
      quote_hash: args.quoteHash,
      pickup_code_hash: args.pickupCodeHash,
      release_deadline: args.releaseDeadline,
    },
  );
}

export interface MerchantOrderAccounts {
  merchant: Address;
  merchantWallet: Address;
  order: Address;
}
export function buildMarkPreparingInstruction(accounts: MerchantOrderAccounts, orderId: OrderId): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "mark_preparing",
    { merchant: accounts.merchant, merchant_wallet: accounts.merchantWallet, order: accounts.order },
    { order_id: orderId },
  );
}
export function buildMarkReadyInstruction(accounts: MerchantOrderAccounts, orderId: OrderId): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "mark_ready",
    { merchant: accounts.merchant, merchant_wallet: accounts.merchantWallet, order: accounts.order },
    { order_id: orderId },
  );
}

export interface ConfirmPickupAccounts {
  merchant: Address;
  merchantWallet: Address;
  order: Address;
  vault: Address;
  merchantTokenAccount: Address;
  buyer: Address;
}
export function buildConfirmPickupInstruction(accounts: ConfirmPickupAccounts, orderId: OrderId, code: string): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "confirm_pickup",
    {
      merchant: accounts.merchant,
      merchant_wallet: accounts.merchantWallet,
      order: accounts.order,
      vault: accounts.vault,
      merchant_token_account: accounts.merchantTokenAccount,
      buyer: accounts.buyer,
    },
    { order_id: orderId, code },
  );
}

export interface RefundAccounts {
  caller: Address;
  order: Address;
  vault: Address;
  buyerTokenAccount: Address;
  buyer: Address;
}
export function buildRefundInstruction(accounts: RefundAccounts, orderId: OrderId): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "refund",
    {
      caller: accounts.caller,
      order: accounts.order,
      vault: accounts.vault,
      buyer_token_account: accounts.buyerTokenAccount,
      buyer: accounts.buyer,
    },
    { order_id: orderId },
  );
}

export interface UserReleaseAccounts {
  buyer: Address;
  order: Address;
  vault: Address;
  merchantWallet: Address;
  merchantTokenAccount: Address;
}
export function buildUserReleaseInstruction(accounts: UserReleaseAccounts, orderId: OrderId): Instruction {
  return buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "user_release",
    {
      buyer: accounts.buyer,
      order: accounts.order,
      vault: accounts.vault,
      merchant_wallet: accounts.merchantWallet,
      merchant_token_account: accounts.merchantTokenAccount,
    },
    { order_id: orderId },
  );
}

// ---------------------------------------------------------------------------
// order_receipt
// ---------------------------------------------------------------------------
export interface CreateReceiptAccounts {
  relayer: Address;
  receiptConfig: Address;
  receipt: Address;
}
export interface CreateReceiptArgs {
  receiptId: bigint | number;
  taskRef: string;
  totalResearchMicroUsdc: bigint | number;
  totalMainMicroUsdc: bigint | number;
  completedItems: bigint | number;
  totalItems: bigint | number;
  metadataUri: string;
  metadataHash: Uint8Array;
}
export function buildCreateReceiptInstruction(accounts: CreateReceiptAccounts, args: CreateReceiptArgs): Instruction {
  return buildInstruction(
    ORDER_RECEIPT_IDL,
    ORDER_RECEIPT_PROGRAM_ID,
    "create_receipt",
    { relayer: accounts.relayer, receipt_config: accounts.receiptConfig, receipt: accounts.receipt },
    {
      receipt_id: args.receiptId,
      task_ref: args.taskRef,
      total_research_micro_usdc: args.totalResearchMicroUsdc,
      total_main_micro_usdc: args.totalMainMicroUsdc,
      completed_items: args.completedItems,
      total_items: args.totalItems,
      metadata_uri: args.metadataUri,
      metadata_hash: args.metadataHash,
    },
  );
}

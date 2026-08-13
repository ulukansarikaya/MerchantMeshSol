import { getProgramDerivedAddress, getU64Encoder, getUtf8Encoder, type ProgramDerivedAddress } from "@solana/kit";
import { MERCHANT_DIRECTORY_PROGRAM_ID, ORDER_ESCROW_PROGRAM_ID, ORDER_RECEIPT_PROGRAM_ID } from "./programIds.js";

const utf8 = getUtf8Encoder();
const u64le = getU64Encoder(); // little-endian, matching Rust's `to_le_bytes()` on the program side

// ---------------------------------------------------------------------------
// merchant_directory
// ---------------------------------------------------------------------------
export function deriveDirectoryStatePda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MERCHANT_DIRECTORY_PROGRAM_ID,
    seeds: [utf8.encode("directory_state")],
  });
}

export function deriveMerchantPda(merchantId: bigint | number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: MERCHANT_DIRECTORY_PROGRAM_ID,
    seeds: [utf8.encode("merchant"), u64le.encode(merchantId)],
  });
}

// ---------------------------------------------------------------------------
// order_escrow
// ---------------------------------------------------------------------------
export function deriveEscrowConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_ESCROW_PROGRAM_ID,
    seeds: [utf8.encode("escrow_config")],
  });
}

export function deriveMerchantWalletPda(merchantId: bigint | number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_ESCROW_PROGRAM_ID,
    seeds: [utf8.encode("merchant_wallet"), u64le.encode(merchantId)],
  });
}

export function deriveOrderPda(orderId: bigint | number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_ESCROW_PROGRAM_ID,
    seeds: [utf8.encode("order"), u64le.encode(orderId)],
  });
}

export function deriveVaultPda(orderId: bigint | number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_ESCROW_PROGRAM_ID,
    seeds: [utf8.encode("vault"), u64le.encode(orderId)],
  });
}

// ---------------------------------------------------------------------------
// order_receipt
// ---------------------------------------------------------------------------
export function deriveReceiptConfigPda(): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_RECEIPT_PROGRAM_ID,
    seeds: [utf8.encode("receipt_config")],
  });
}

export function deriveReceiptPda(receiptId: bigint | number): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: ORDER_RECEIPT_PROGRAM_ID,
    seeds: [utf8.encode("receipt"), u64le.encode(receiptId)],
  });
}

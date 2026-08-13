import { address, type Address } from "@solana/kit";

// Program ids from solana/programs/*/src/lib.rs `declare_id!(...)`. Update
// here (and in the corresponding Anchor.toml / declare_id!) together if the
// programs are ever redeployed under new keys.
export const MERCHANT_DIRECTORY_PROGRAM_ID: Address = address("wRjcJxHLmDiStxUv5hhg4m3EZKnywZcBQj1W27unSHZ");
export const ORDER_ESCROW_PROGRAM_ID: Address = address("3M8mUguDLdnvPqvVE9KYp11MfkTcGYCo8UhnVqoCCCuV");
export const ORDER_RECEIPT_PROGRAM_ID: Address = address("B5htcm88nzRtNyfHMyhh7SQ5pHudw1dMx6Ean5xP2wsm");

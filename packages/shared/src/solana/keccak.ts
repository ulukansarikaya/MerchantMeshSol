import { keccak_256 } from "@noble/hashes/sha3";

/**
 * Ethereum-variant Keccak-256 (NOT NIST SHA3-256 — different padding).
 * The order_escrow program hashes pickup codes with `solana_keccak_hasher`,
 * which calls Solana's `sol_keccak256` syscall — the same Keccak-256 variant
 * as Ethereum's. Off-chain code that needs to match `pickup_code_hash` (e.g.
 * hashing the pickup code before calling `fund`, or checking a submitted
 * code before calling `confirm_pickup`) must use this exact function.
 */
export function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

export function keccak256Utf8(text: string): Uint8Array {
  return keccak_256(new TextEncoder().encode(text));
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** Lowercase hex, no "0x" prefix — the encoding used for storing hashes in mock-mode SQLite. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += HEX[b];
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function keccak256HexUtf8(text: string): string {
  return bytesToHex(keccak256Utf8(text));
}

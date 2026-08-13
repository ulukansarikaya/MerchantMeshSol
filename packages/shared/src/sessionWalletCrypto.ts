// Subpath export ("@merchantmesh/shared/sessionWalletCrypto") — Node-only
// (uses node:crypto), kept out of the main barrel so the web bundle never
// pulls it in. Faz J §1: AES-256-GCM envelope for session-wallet private keys.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;

/** Decodes the 32-byte master key from base64; throws if missing/wrong length (fail-closed). */
export function loadMasterKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.SESSION_WALLET_MASTER_KEY;
  if (!raw) throw new Error("SESSION_WALLET_MASTER_KEY is not set — required to (de)crypt session wallet keys.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`SESSION_WALLET_MASTER_KEY must be a base64-encoded 32-byte key (got ${key.length} bytes).`);
  }
  return key;
}

/**
 * Encrypts a private key into a single base64 envelope (iv | tag | ciphertext).
 * The raw key is never returned in cleartext form anywhere but the return of
 * decryptPrivateKey — callers must never log it.
 */
export function encryptPrivateKey(privateKey: string, masterKey: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, masterKey, iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptPrivateKey(envelope: string, masterKey: Buffer): string {
  const buf = Buffer.from(envelope, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, masterKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

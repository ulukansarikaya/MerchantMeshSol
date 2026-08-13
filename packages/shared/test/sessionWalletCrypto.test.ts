import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadMasterKey, encryptPrivateKey, decryptPrivateKey } from "../src/sessionWalletCrypto.js";

/** sessionWalletCrypto is chain-agnostic — it just encrypts an opaque string, so
 *  a random 32-byte hex seed is as good a fixture as a real Ed25519 seed. */
function generatePrivateKey(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

describe("Faz J §1 — session wallet AES-256-GCM envelope", () => {
  const masterKey = randomBytes(32);

  it("round-trips a private key through encrypt/decrypt", () => {
    const key = generatePrivateKey();
    const envelope = encryptPrivateKey(key, masterKey);
    expect(envelope).not.toContain(key.slice(2)); // ciphertext must not leak the raw hex
    expect(decryptPrivateKey(envelope, masterKey)).toBe(key);
  });

  it("rejects a tampered envelope (GCM auth tag fails)", () => {
    const key = generatePrivateKey();
    const envelope = encryptPrivateKey(key, masterKey);
    const bytes = Buffer.from(envelope, "base64");
    bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0xff) & 0xff; // flip a ciphertext bit
    expect(() => decryptPrivateKey(bytes.toString("base64"), masterKey)).toThrow();
  });

  it("rejects decryption with the wrong master key", () => {
    const key = generatePrivateKey();
    const envelope = encryptPrivateKey(key, masterKey);
    expect(() => decryptPrivateKey(envelope, randomBytes(32))).toThrow();
  });

  it("loadMasterKey enforces exactly 32 bytes", () => {
    expect(() => loadMasterKey({ SESSION_WALLET_MASTER_KEY: undefined })).toThrow();
    expect(() => loadMasterKey({ SESSION_WALLET_MASTER_KEY: Buffer.from("too-short").toString("base64") })).toThrow();
    expect(() => loadMasterKey({ SESSION_WALLET_MASTER_KEY: masterKey.toString("base64") })).not.toThrow();
  });
});

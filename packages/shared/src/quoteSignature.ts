import {
  address,
  getAddressFromPublicKey,
  getBase58Codec,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  signBytes,
  signatureBytes,
  verifySignature,
  type KeyPairSigner,
  type ReadonlyUint8Array,
} from "@solana/kit";
import type { Quote, SignedQuote } from "./schemas.js";

/**
 * Solana has no EIP-712 equivalent — there's no typed-data standard tied to a
 * chainId/verifyingContract domain. Instead the merchant's quote is signed
 * directly with the merchant signer's Ed25519 key over a fixed canonical byte
 * serialization (JSON with an explicit field order, UTF-8 encoded). Merchant
 * wallet addresses ARE the raw Ed25519 public key (base58-encoded), so
 * verification just needs the address on the quote — no separate domain.
 */
function quoteMessageBytes(quote: Quote): ReadonlyUint8Array {
  const canonical = {
    quoteId: quote.quoteId,
    merchantId: quote.merchantId,
    merchantWallet: quote.merchantWallet,
    items: quote.items.map((i) => ({ sku: i.sku, qty: i.qty, unitPriceMicroUsdc: i.unitPriceMicroUsdc })),
    totalMicroUsdc: quote.totalMicroUsdc,
    validUntil: quote.validUntil,
    nonce: quote.nonce,
  };
  return getUtf8Encoder().encode(JSON.stringify(canonical));
}

export async function signQuote(signer: KeyPairSigner, quote: Quote): Promise<SignedQuote> {
  const sigBytes = await signBytes(signer.keyPair.privateKey, quoteMessageBytes(quote));
  return { ...quote, signature: getBase58Codec().decode(sigBytes) };
}

/** Verify the quote signature against the merchant's registered wallet (== its Ed25519 public key). */
export async function verifyQuoteSignature(signed: SignedQuote): Promise<boolean> {
  const { signature, ...quote } = signed;
  const publicKey = await getPublicKeyFromAddress(address(quote.merchantWallet));
  const sigBytes = signatureBytes(getBase58Codec().encode(signature));
  return verifySignature(publicKey, sigBytes, quoteMessageBytes(quote));
}

/** SHA-256 of the canonical quote bytes — stored on-chain as quoteHash (opaque to the program, see solana/programs/order_escrow). */
export async function hashQuote(quote: Quote): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(quoteMessageBytes(quote)));
  return new Uint8Array(digest);
}

/** Convenience: same as getAddressFromPublicKey, re-exported so callers don't need a direct @solana/kit import just for this. */
export { getAddressFromPublicKey };

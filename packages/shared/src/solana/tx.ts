import {
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
} from "@solana/kit";

/**
 * Builds, signs, submits, and polls for confirmation of a transaction — the
 * Solana analog of viem's `walletClient.writeContract()` +
 * `publicClient.waitForTransactionReceipt()` pair. Polling (not a websocket
 * subscription) so callers only need an HTTP RPC URL, matching the old
 * EVM-generic single-RPC-URL config shape.
 */
export async function sendAndConfirmInstructions(
  rpc: Rpc<SolanaRpcApi>,
  payer: KeyPairSigner,
  instructions: Instruction[],
  opts: { timeoutMs?: number } = {},
): Promise<Signature> {
  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signedTx = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signedTx);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signedTx), { encoding: "base64" }).send();

  const timeoutMs = opts.timeoutMs ?? 30_000;
  const start = Date.now();
  for (;;) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return signature;
    if (Date.now() - start > timeoutMs) throw new Error(`transaction ${signature} not confirmed within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

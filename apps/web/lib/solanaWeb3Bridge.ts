// The wallet-adapter ecosystem (@solana/wallet-adapter-react) still speaks
// classic @solana/web3.js v1 (Transaction/PublicKey/Connection) — it hasn't
// moved to @solana/kit. packages/shared's instruction builders (fund,
// confirm_pickup, etc.) return @solana/kit's plain-object `Instruction` type
// instead. This is the small bridge between the two: convert kit
// instructions to classic ones, then compile+send a v0 transaction through
// whatever wallet is connected.
import type { Instruction as KitInstruction } from "@solana/kit";
import { AccountRole } from "@solana/kit";
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

export function toWeb3JsInstruction(ix: KitInstruction): TransactionInstruction {
  const keys = (ix.accounts ?? []).map((a) => ({
    pubkey: new PublicKey(a.address),
    isSigner: a.role === AccountRole.READONLY_SIGNER || a.role === AccountRole.WRITABLE_SIGNER,
    isWritable: a.role === AccountRole.WRITABLE || a.role === AccountRole.WRITABLE_SIGNER,
  }));
  return new TransactionInstruction({
    keys,
    programId: new PublicKey(ix.programAddress),
    data: Buffer.from(ix.data ?? new Uint8Array()),
  });
}

/** Compiles a v0 transaction from kit instructions, sends it via the connected wallet, and waits for confirmation. */
export async function sendKitInstructions(
  connection: Connection,
  wallet: Pick<WalletContextState, "publicKey" | "sendTransaction">,
  instructions: KitInstruction[],
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  const web3Instructions = instructions.map(toWeb3JsInstruction);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: web3Instructions,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const signature = await wallet.sendTransaction(transaction, connection);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
  return signature;
}

/**
 * Signs several independent v0 transactions in one wallet batch prompt, then
 * submits them in order. Keeping one fund instruction per transaction avoids
 * Solana's 1232-byte packet limit while preserving a single Phantom approval.
 */
export async function sendKitInstructionBatch(
  connection: Connection,
  wallet: Pick<WalletContextState, "publicKey" | "signAllTransactions">,
  instructionBatches: KitInstruction[][],
  onConfirmed?: (signature: string, index: number) => Promise<void>,
): Promise<string[]> {
  if (!wallet.publicKey) throw new Error("Wallet not connected");
  if (!wallet.signAllTransactions) {
    throw new Error("This wallet does not support batch signing. Use the individual funding retry section.");
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const transactions = instructionBatches.map((instructions) => {
    const message = new TransactionMessage({
      payerKey: wallet.publicKey!,
      recentBlockhash: blockhash,
      instructions: instructions.map(toWeb3JsInstruction),
    }).compileToV0Message();
    return new VersionedTransaction(message);
  });

  const signedTransactions = await wallet.signAllTransactions(transactions);
  const signatures: string[] = [];

  // Order matters because every fund instruction consumes next_order_id.
  for (const [index, transaction] of signedTransactions.entries()) {
    try {
      const signature = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (confirmation.value.err) {
        throw new Error(`Solana confirmed the transaction with an error: ${JSON.stringify(confirmation.value.err)}`);
      }
      signatures.push(signature);
      await onConfirmed?.(signature, index);
    } catch (error) {
      const detail = await extractSolanaError(connection, error);
      throw new Error(detail);
    }
  }

  return signatures;
}

async function extractSolanaError(connection: Connection, error: unknown): Promise<string> {
  const candidate = error as { message?: string; logs?: string[]; signature?: string; getLogs?: (connection: Connection) => Promise<string[]> };
  let logs = candidate.logs;
  if (!logs && candidate.getLogs) {
    try {
      logs = await candidate.getLogs(connection);
    } catch {
      // Fall through to the original message.
    }
  }
  const programError = logs?.slice().reverse().find((line) => line.includes("Error") || line.includes("failed"));
  if (programError) return `Solana simulation failed: ${programError}`;
  return candidate.message ?? "Solana transaction failed before submission.";
}

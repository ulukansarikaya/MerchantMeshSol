/**
 * Faz J — reconciles packages/db's payment_events ledger against the actual
 * on-chain USDC transfers each session wallet has sent, by re-scanning each
 * wallet's associated token account for outgoing SPL Token "transfer"
 * instructions. Exits non-zero on any mismatch so it can be wired into CI/an
 * ops check later.
 */
import { address } from "@solana/kit";
import { eq, and } from "drizzle-orm";
import { getDb, closeDb } from "../packages/db/src/index.js";
import { sessionWallets, paymentEvents } from "../packages/db/src/schema/index.js";
import { createSolanaRpcClient, readSolanaEnvConfig, deriveAssociatedTokenAddress } from "../packages/shared/src/index.js";
import { loadRootEnv, env } from "../packages/shared/src/env.js";

loadRootEnv();

/** Parsed SPL Token "transfer" instruction info, as returned by getTransaction's jsonParsed encoding. */
interface ParsedSplTransferInfo {
  source: string;
  destination: string;
  authority: string;
  amount: string;
}

async function main() {
  const db = getDb();
  const cfg = readSolanaEnvConfig();
  const rpc = createSolanaRpcClient(cfg);
  const usdcMint = address(env("USDC_MINT"));

  const wallets = await db.select().from(sessionWallets);
  console.log(`[ledger-check] reconciling ${wallets.length} session wallet(s)…`);

  let mismatches = 0;
  for (const wallet of wallets) {
    const ata = await deriveAssociatedTokenAddress(address(wallet.address), usdcMint);

    const signatures = await rpc.getSignaturesForAddress(ata, { limit: 1000 }).send();
    let onChainTotal = 0n;
    for (const { signature } of signatures) {
      const tx = await rpc
        .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0, encoding: "jsonParsed" })
        .send();
      if (!tx || tx.meta?.err) continue;
      const instructions = tx.transaction.message.instructions as unknown[];
      for (const ix of instructions) {
        const parsed = ix as { program?: string; parsed?: { type?: string; info?: ParsedSplTransferInfo } };
        if (parsed.program !== "spl-token" || parsed.parsed?.type !== "transfer") continue;
        const info = parsed.parsed.info;
        if (!info || info.source !== ata) continue;
        onChainTotal += BigInt(info.amount);
      }
    }

    const events = await db
      .select()
      .from(paymentEvents)
      .where(and(eq(paymentEvents.accountId, wallet.accountId), eq(paymentEvents.direction, "debit"), eq(paymentEvents.status, "confirmed")));
    const ledgerTotal = events.reduce((sum, e) => sum + e.amountMicroUsdc, 0n);

    const ok = onChainTotal === ledgerTotal;
    if (!ok) mismatches++;
    console.log(
      `[ledger-check] ${wallet.address} — on-chain: ${onChainTotal} µUSDC, ledger: ${ledgerTotal} µUSDC — ${ok ? "OK" : "MISMATCH"}`,
    );
  }

  await closeDb();
  if (mismatches > 0) {
    console.error(`[ledger-check] ${mismatches} wallet(s) mismatched.`);
    process.exit(1);
  }
  console.log("[ledger-check] all wallets reconciled.");
}

main().catch((err) => {
  console.error("[ledger-check] failed:", err);
  process.exit(1);
});

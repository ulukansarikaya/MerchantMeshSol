/**
 * Chain smoke test — proves the order_escrow flow end-to-end on a REAL
 * Solana cluster (devnet by default; whatever SOLANA_* + USDC_MINT env
 * points at).
 *
 * Scenarios:
 *   1. Happy path: fund → markPreparing → markReady →
 *      confirmPickup(correct code) → merchant's USDC balance increased.
 *   2. Wrong pickup code is rejected (no funds move).
 *   3. Past-deadline refund: fund with a short releaseDeadline, wait it out,
 *      call refund() from a third party (relayer) → buyer's balance restored.
 *
 * Unlike the old EVM version there is no approve() step — the buyer's
 * associated token account just needs to already hold enough USDC (fund a
 * devnet faucet balance ahead of time), since the program moves tokens via a
 * direct CPI transfer authorized by the buyer's own signature.
 *
 * Uses the relayer key as BOTH deployer and test buyer (see /solana's deploy
 * docs — devnet USDC faucets are rate-limited, so reusing one funded address
 * keeps this runnable without funding a 7th wallet), and Ali Kasap's
 * merchant key for the merchant-side calls.
 *
 * Run: pnpm tsx scripts/chain-smoke.ts
 */
import { randomBytes } from "node:crypto";
import { address, createKeyPairSignerFromPrivateKeyBytes, type Address, type KeyPairSigner } from "@solana/kit";
import {
  createSolanaRpcClient,
  readSolanaEnvConfig,
  explorerTxUrl,
  sendAndConfirmInstructions,
  fetchAndDecodeAccount,
  fetchTokenAccountBalance,
  deriveAssociatedTokenAddress,
  deriveEscrowConfigPda,
  deriveMerchantWalletPda,
  deriveOrderPda,
  deriveVaultPda,
  buildFundInstruction,
  buildMarkPreparingInstruction,
  buildMarkReadyInstruction,
  buildConfirmPickupInstruction,
  buildRefundInstruction,
  keccak256HexUtf8,
  hexToBytes,
  ORDER_ESCROW_IDL,
  type SolanaEnvConfig,
} from "../packages/shared/src/index.js";
import { loadRootEnv, env } from "../packages/shared/src/env.js";

loadRootEnv();

const cfg: SolanaEnvConfig = readSolanaEnvConfig();
const rpc = createSolanaRpcClient(cfg);
const usdcMint = address(env("USDC_MINT"));
const merchantId = 1n; // Ali Kasap — see /solana's seed/deploy script

interface DecodedEscrowConfig {
  next_order_id: bigint;
}
interface DecodedMerchantWallet {
  wallet: Address;
}

async function signerFromHexSeed(hex: string): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(hexToBytes(hex));
}

const relayer = await signerFromHexSeed(env("RELAYER_PRIVATE_KEY"));
const buyer = relayer; // same wallet plays deployer/relayer/buyer in this smoke test
const merchant = await signerFromHexSeed(env("MERCHANT_ALI_KASAP_PRIVATE_KEY"));

function log(msg: string): void {
  console.log(`  │ ${msg}`);
}
function logTx(label: string, signature: string): void {
  log(`${label}: ${explorerTxUrl(cfg, signature)}`);
}

async function usdcBalance(owner: Address): Promise<bigint> {
  const ata = await deriveAssociatedTokenAddress(owner, usdcMint);
  return fetchTokenAccountBalance(rpc, ata);
}

async function merchantWalletAddress(): Promise<Address> {
  const [merchantWalletPda] = await deriveMerchantWalletPda(merchantId);
  const decoded = await fetchAndDecodeAccount<DecodedMerchantWallet>(rpc, ORDER_ESCROW_IDL, "MerchantWallet", merchantWalletPda);
  if (!decoded) throw new Error(`merchant_wallet not registered for merchant ${merchantId} — run the /solana deploy/init script first`);
  return decoded.wallet;
}

async function fundOrder(amountMicro: bigint, releaseDeadline: bigint): Promise<{ orderId: bigint; pickupCode: string }> {
  const pickupCode = randomBytes(3).toString("hex");
  const pickupCodeHash = hexToBytes(keccak256HexUtf8(pickupCode));
  const quoteHash = hexToBytes(keccak256HexUtf8(`smoke-test-quote-${Date.now()}`));

  const [escrowConfigPda] = await deriveEscrowConfigPda();
  const config = await fetchAndDecodeAccount<DecodedEscrowConfig>(rpc, ORDER_ESCROW_IDL, "EscrowConfig", escrowConfigPda);
  if (!config) throw new Error("escrow_config is not initialized on this cluster — run the /solana deploy/init script first");
  const orderId = config.next_order_id;

  const [merchantWallet] = await deriveMerchantWalletPda(merchantId);
  const [order] = await deriveOrderPda(orderId);
  const [vault] = await deriveVaultPda(orderId);
  const buyerTokenAccount = await deriveAssociatedTokenAddress(buyer.address, usdcMint);

  const ix = buildFundInstruction(
    { buyer: buyer.address, escrowConfig: escrowConfigPda, merchantWallet, order, usdcMint, vault, buyerTokenAccount },
    { orderId, amount: amountMicro, quoteHash, pickupCodeHash, releaseDeadline },
  );
  const signature = await sendAndConfirmInstructions(rpc, buyer, [ix]);
  logTx("fund", signature);
  log(`order #${orderId} funded (${amountMicro} µUSDC, deadline ${releaseDeadline})`);
  return { orderId, pickupCode };
}

async function markPreparingAndReady(orderId: bigint): Promise<void> {
  const [merchantWallet] = await deriveMerchantWalletPda(merchantId);
  const [order] = await deriveOrderPda(orderId);

  const prepIx = buildMarkPreparingInstruction({ merchant: merchant.address, merchantWallet, order }, orderId);
  const prepSig = await sendAndConfirmInstructions(rpc, merchant, [prepIx]);
  logTx("markPreparing", prepSig);

  const readyIx = buildMarkReadyInstruction({ merchant: merchant.address, merchantWallet, order }, orderId);
  const readySig = await sendAndConfirmInstructions(rpc, merchant, [readyIx]);
  logTx("markReady", readySig);
}

async function confirmPickup(orderId: bigint, code: string): Promise<string> {
  const [merchantWallet] = await deriveMerchantWalletPda(merchantId);
  const [order] = await deriveOrderPda(orderId);
  const [vault] = await deriveVaultPda(orderId);
  const merchantWalletAddr = await merchantWalletAddress();
  const merchantTokenAccount = await deriveAssociatedTokenAddress(merchantWalletAddr, usdcMint);

  const ix = buildConfirmPickupInstruction(
    { merchant: merchant.address, merchantWallet, order, vault, merchantTokenAccount, buyer: buyer.address },
    orderId,
    code,
  );
  return sendAndConfirmInstructions(rpc, merchant, [ix]);
}

async function refund(orderId: bigint, caller: KeyPairSigner): Promise<string> {
  const [order] = await deriveOrderPda(orderId);
  const [vault] = await deriveVaultPda(orderId);
  const buyerTokenAccount = await deriveAssociatedTokenAddress(buyer.address, usdcMint);

  const ix = buildRefundInstruction({ caller: caller.address, order, vault, buyerTokenAccount, buyer: buyer.address }, orderId);
  return sendAndConfirmInstructions(rpc, caller, [ix]);
}

async function scenarioHappyPath(): Promise<void> {
  console.log("┌─ Scenario 1 — Happy path: fund → prepare → ready → confirmPickup");
  const merchantWalletAddr = await merchantWalletAddress();
  const merchantBefore = await usdcBalance(merchantWalletAddr);

  const { orderId, pickupCode } = await fundOrder(500_000n, BigInt(Math.floor(Date.now() / 1000) + 3600));
  await markPreparingAndReady(orderId);

  const confirmSig = await confirmPickup(orderId, pickupCode);
  logTx("confirmPickup(correct code)", confirmSig);

  const merchantAfter = await usdcBalance(merchantWalletAddr);
  const delta = merchantAfter - merchantBefore;
  if (delta !== 500_000n) throw new Error(`expected +500000 µUSDC, got: ${delta}`);
  log(`✅ Merchant balance +${delta} µUSDC — escrow really released.`);
  console.log("└─ Scenario 1 PASSED ✔\n");
}

async function scenarioWrongCode(): Promise<void> {
  console.log("┌─ Scenario 2 — Wrong pickup code must be rejected");
  const { orderId } = await fundOrder(500_000n, BigInt(Math.floor(Date.now() / 1000) + 3600));
  await markPreparingAndReady(orderId);

  let rejected = false;
  try {
    await confirmPickup(orderId, "000000");
  } catch (err) {
    rejected = true;
    log(`✅ Rejected as expected: ${(err as Error).message.slice(0, 120)}`);
  }
  if (!rejected) throw new Error("wrong code was NOT rejected — security bug!");

  // Clean up: try to refund it back so this order doesn't sit funded forever
  // (the buyer-pre-Preparing rule no longer applies here, so this itself may
  // fail — that's fine, it's best-effort cleanup, not part of the assertion).
  const refundSig = await refund(orderId, relayer).catch(() => undefined);
  if (refundSig) {
    logTx("cleanup refund (may itself be rejected — buyer-pre-Preparing rule no longer applies; ignored if so)", refundSig);
  }
  console.log("└─ Scenario 2 PASSED ✔\n");
}

async function scenarioPastDeadlineRefund(): Promise<void> {
  console.log("┌─ Scenario 3 — Anyone can refund after the release deadline");
  const buyerBefore = await usdcBalance(buyer.address);
  const shortDeadline = BigInt(Math.floor(Date.now() / 1000) + 8);
  const { orderId } = await fundOrder(300_000n, shortDeadline);

  log("waiting for releaseDeadline to pass (10s)…");
  await new Promise((r) => setTimeout(r, 10_000));

  const refundSig = await refund(orderId, relayer);
  logTx("refund (relayer, past deadline)", refundSig);

  const buyerAfter = await usdcBalance(buyer.address);
  if (buyerAfter < buyerBefore) throw new Error("buyer balance did not increase — refund appears to have failed");
  log(`✅ Buyer balance restored (${buyerBefore} → ${buyerAfter}).`);
  console.log("└─ Scenario 3 PASSED ✔\n");
}

async function main() {
  console.log(`Chain smoke test — ${cfg.cluster} (${cfg.rpcUrl})`);
  console.log(`  USDC mint: ${usdcMint}`);
  console.log(`  Buyer:     ${buyer.address}`);
  console.log(`  Merchant:  ${merchant.address} (ali-kasap)\n`);

  await scenarioHappyPath();
  await scenarioWrongCode();
  await scenarioPastDeadlineRefund();

  console.log("✔ All scenarios verified on the real chain.");
}

main().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});

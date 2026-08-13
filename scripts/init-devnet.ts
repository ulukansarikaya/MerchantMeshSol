/**
 * One-time (idempotent) devnet bootstrap for the 3 deployed Anchor programs.
 * Deploying the .so files (`anchor deploy --provider.cluster devnet` from
 * /solana) is a separate, earlier step — this script only initializes the
 * on-chain config PDAs and registers the 5 seed merchants, so the apps have
 * something real to talk to once MOCK_CHAIN=false.
 *
 * Safe to re-run: every step first checks whether the target account already
 * exists and skips it if so, rather than failing on "already in use".
 *
 * If USDC_MINT is not set, this script creates a fresh devnet-only SPL
 * test-USDC mint (6 decimals, mint authority = relayer) and mints some to the
 * relayer's (buyer's, in chain-smoke.ts's convention) associated token
 * account — print the resulting mint address at the end and copy it into
 * `.env` as USDC_MINT so subsequent runs (and chain-smoke.ts) reuse it
 * instead of creating a new one every time.
 *
 * Requires real network access to SOLANA_RPC_URL (devnet) — this cannot run
 * in a network-isolated environment.
 *
 * Run: pnpm tsx scripts/init-devnet.ts
 */
import {
  address,
  createKeyPairSignerFromPrivateKeyBytes,
  generateKeyPairSigner,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  createSolanaRpcClient,
  readSolanaEnvConfig,
  sendAndConfirmInstructions,
  fetchAndDecodeAccount,
  deriveAssociatedTokenAddress,
  deriveDirectoryStatePda,
  deriveMerchantPda,
  deriveEscrowConfigPda,
  deriveMerchantWalletPda,
  deriveReceiptConfigPda,
  keccak256Utf8,
  buildInstruction,
  MERCHANT_DIRECTORY_IDL,
  ORDER_ESCROW_IDL,
  ORDER_RECEIPT_IDL,
  MERCHANT_DIRECTORY_PROGRAM_ID,
  ORDER_ESCROW_PROGRAM_ID,
  ORDER_RECEIPT_PROGRAM_ID,
  SEED_MERCHANTS,
  type SolanaEnvConfig,
} from "../packages/shared/src/index.js";
import { loadRootEnv, env } from "../packages/shared/src/env.js";

loadRootEnv();

const cfg: SolanaEnvConfig = readSolanaEnvConfig();
const rpc = createSolanaRpcClient(cfg);
const merchantsUrl = process.env.MERCHANTS_URL ?? "http://localhost:4000";

const USDC_DECIMALS = 6;
const AIRDROP_LAMPORTS = 1_000_000_000n; // 1 SOL
const MIN_BALANCE_FOR_AIRDROP = 100_000_000n; // top up if below 0.1 SOL
const TEST_MINT_AMOUNT = 1_000_000_000n; // 1000 test-USDC (6 decimals) to the relayer/buyer

function log(msg: string): void {
  console.log(`  │ ${msg}`);
}

async function signerFromHexSeed(hex: string): Promise<KeyPairSigner> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

async function ensureAirdropped(who: string, addr: Address): Promise<void> {
  try {
    const { value: balance } = await rpc.getBalance(addr).send();
    if (balance >= MIN_BALANCE_FOR_AIRDROP) return;
    log(`airdropping 1 SOL to ${who} (${addr})…`);
    const sig = await rpc.requestAirdrop(addr, lamports(AIRDROP_LAMPORTS)).send();
    log(`airdrop tx: ${sig}`);
  } catch (err) {
    console.warn(`  │ ⚠ airdrop to ${who} failed (devnet faucet is rate-limited — fund it manually if needed): ${(err as Error).message}`);
  }
}

async function ensureUsdcMint(relayer: KeyPairSigner): Promise<{ mint: Address; createdNew: boolean }> {
  const existing = process.env.USDC_MINT;
  if (existing) return { mint: address(existing), createdNew: false };

  log("USDC_MINT not set — creating a fresh devnet test-USDC mint (6 decimals)…");
  const newMint = await generateKeyPairSigner();
  const space = BigInt(getMintSize());
  const rentLamports = await rpc.getMinimumBalanceForRentExemption(space).send();

  const createIx = getCreateAccountInstruction({
    payer: relayer,
    newAccount: newMint,
    lamports: rentLamports,
    space,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  });
  const initIx = getInitializeMintInstruction({
    mint: newMint.address,
    decimals: USDC_DECIMALS,
    mintAuthority: relayer.address,
  });
  const sig = await sendAndConfirmInstructions(rpc, relayer, [createIx, initIx]);
  log(`mint created: ${newMint.address} (tx ${sig})`);
  return { mint: newMint.address, createdNew: true };
}

async function mintTestUsdcToRelayer(relayer: KeyPairSigner, mint: Address): Promise<void> {
  const ataIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: relayer, owner: relayer.address, mint });
  const ata = await deriveAssociatedTokenAddress(relayer.address, mint);
  const mintToIx = getMintToInstruction({ mint, token: ata, mintAuthority: relayer, amount: TEST_MINT_AMOUNT });
  const sig = await sendAndConfirmInstructions(rpc, relayer, [ataIx, mintToIx]);
  log(`minted ${TEST_MINT_AMOUNT} test-USDC (µ) to relayer's ATA ${ata} (tx ${sig})`);
}

async function ensureDirectoryInitialized(authority: KeyPairSigner): Promise<void> {
  const [directoryState] = await deriveDirectoryStatePda();
  const existing = await fetchAndDecodeAccount(rpc, MERCHANT_DIRECTORY_IDL, "DirectoryState", directoryState);
  if (existing) return log("merchant_directory: directory_state already initialized, skipping.");
  const ix = buildInstruction(MERCHANT_DIRECTORY_IDL, MERCHANT_DIRECTORY_PROGRAM_ID, "initialize", {
    authority: authority.address,
    directory_state: directoryState,
  });
  const sig = await sendAndConfirmInstructions(rpc, authority, [ix]);
  log(`merchant_directory initialized (tx ${sig})`);
}

async function ensureEscrowInitialized(authority: KeyPairSigner, usdcMint: Address): Promise<void> {
  const [escrowConfig] = await deriveEscrowConfigPda();
  const existing = await fetchAndDecodeAccount<{ usdc_mint: Address }>(rpc, ORDER_ESCROW_IDL, "EscrowConfig", escrowConfig);
  if (existing) {
    if (existing.usdc_mint === usdcMint) return log("order_escrow: escrow_config already uses the configured USDC mint, skipping.");
    const updateIx = buildInstruction(
      ORDER_ESCROW_IDL,
      ORDER_ESCROW_PROGRAM_ID,
      "set_usdc_mint",
      { authority: authority.address, escrow_config: escrowConfig, usdc_mint: usdcMint },
    );
    const updateSig = await sendAndConfirmInstructions(rpc, authority, [updateIx]);
    return log(`order_escrow: usdc_mint updated ${existing.usdc_mint} → ${usdcMint} (tx ${updateSig})`);
  }
  const ix = buildInstruction(
    ORDER_ESCROW_IDL,
    ORDER_ESCROW_PROGRAM_ID,
    "initialize",
    { authority: authority.address, escrow_config: escrowConfig },
    { arbiter: authority.address, usdc_mint: usdcMint },
  );
  const sig = await sendAndConfirmInstructions(rpc, authority, [ix]);
  log(`order_escrow initialized — arbiter=relayer, usdc_mint=${usdcMint} (tx ${sig})`);
}

async function ensureReceiptInitialized(authority: KeyPairSigner): Promise<void> {
  const [receiptConfig] = await deriveReceiptConfigPda();
  const existing = await fetchAndDecodeAccount(rpc, ORDER_RECEIPT_IDL, "ReceiptConfig", receiptConfig);
  if (existing) return log("order_receipt: receipt_config already initialized, skipping.");
  const ix = buildInstruction(
    ORDER_RECEIPT_IDL,
    ORDER_RECEIPT_PROGRAM_ID,
    "initialize",
    { authority: authority.address, receipt_config: receiptConfig },
    { relayer: authority.address },
  );
  const sig = await sendAndConfirmInstructions(rpc, authority, [ix]);
  log(`order_receipt initialized — relayer=relayer (tx ${sig})`);
}

async function ensureMerchantListed(authority: KeyPairSigner, m: (typeof SEED_MERCHANTS)[number], wallet: Address): Promise<void> {
  const [directoryState] = await deriveDirectoryStatePda();
  const [merchant] = await deriveMerchantPda(m.merchantId);
  const existing = await fetchAndDecodeAccount(rpc, MERCHANT_DIRECTORY_IDL, "Merchant", merchant);
  if (!existing) {
    // No attestation authority deployed yet (see AGENTS.md "Gerçek Mod Geçiş Noktaları" #6) —
    // attestation_uid is a documented all-zero placeholder, not a real attestation.
    const ix = buildInstruction(
      MERCHANT_DIRECTORY_IDL,
      MERCHANT_DIRECTORY_PROGRAM_ID,
      "list_merchant",
      { authority: authority.address, directory_state: directoryState, merchant },
      {
        merchant_id: m.merchantId,
        agent_id: m.agentId,
        name: m.name,
        category: m.category,
        endpoint_uri: `${merchantsUrl}/merchant/${m.slug}`,
        wallet,
        geo_hash: keccak256Utf8(`${m.lat},${m.lng}`),
        attestation_uid: new Uint8Array(32),
      },
    );
    const sig = await sendAndConfirmInstructions(rpc, authority, [ix]);
    log(`merchant_directory: listed ${m.slug} (merchant_id=${m.merchantId}, tx ${sig})`);
  } else {
    log(`merchant_directory: ${m.slug} already listed, skipping.`);
  }

  const [merchantWallet] = await deriveMerchantWalletPda(m.merchantId);
  const existingWallet = await fetchAndDecodeAccount(rpc, ORDER_ESCROW_IDL, "MerchantWallet", merchantWallet);
  if (!existingWallet) {
    const ix = buildInstruction(
      ORDER_ESCROW_IDL,
      ORDER_ESCROW_PROGRAM_ID,
      "set_merchant_wallet",
      { authority: authority.address, escrow_config: (await deriveEscrowConfigPda())[0], merchant_wallet: merchantWallet },
      { merchant_id: m.merchantId, wallet },
    );
    const sig = await sendAndConfirmInstructions(rpc, authority, [ix]);
    log(`order_escrow: set_merchant_wallet for ${m.slug} → ${wallet} (tx ${sig})`);
  } else {
    log(`order_escrow: merchant_wallet for ${m.slug} already set, skipping.`);
  }

  // Pickup release transfers into this ATA. Create it during bootstrap so an
  // external tester never hits a missing merchant token-account failure.
  const mint = address(env("USDC_MINT"));
  const merchantAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({ payer: authority, owner: wallet, mint });
  await sendAndConfirmInstructions(rpc, authority, [merchantAtaIx]);
  log(`merchant payout ATA ready for ${m.slug} (${await deriveAssociatedTokenAddress(wallet, mint)})`);
}

async function main() {
  console.log(`Devnet init — ${cfg.cluster} (${cfg.rpcUrl})`);
  const relayer = await signerFromHexSeed(env("RELAYER_PRIVATE_KEY"));
  console.log(`  Relayer/authority: ${relayer.address}\n`);

  console.log("┌─ Adım 1 — SOL airdrop (relayer + esnaflar)");
  await ensureAirdropped("relayer", relayer.address);
  const merchantSigners: KeyPairSigner[] = [];
  for (const m of SEED_MERCHANTS) {
    const signer = await signerFromHexSeed(env(m.signerKeyEnv));
    merchantSigners.push(signer);
    await ensureAirdropped(m.slug, signer.address);
  }
  console.log("└─ Tamam\n");

  console.log("┌─ Adım 2 — USDC (test) mint");
  const { mint: usdcMint, createdNew } = await ensureUsdcMint(relayer);
  if (createdNew) await mintTestUsdcToRelayer(relayer, usdcMint);
  console.log("└─ Tamam\n");

  console.log("┌─ Adım 3 — Program config PDA'larını initialize et");
  await ensureDirectoryInitialized(relayer);
  await ensureEscrowInitialized(relayer, usdcMint);
  await ensureReceiptInitialized(relayer);
  console.log("└─ Tamam\n");

  console.log("┌─ Adım 4 — 5 esnafı kaydet (list_merchant + set_merchant_wallet)");
  for (let i = 0; i < SEED_MERCHANTS.length; i++) {
    await ensureMerchantListed(relayer, SEED_MERCHANTS[i]!, merchantSigners[i]!.address);
  }
  console.log("└─ Tamam\n");

  console.log("✔ Devnet bootstrap tamamlandı. .env dosyana şunu ekle/kontrol et:");
  console.log(`  USDC_MINT=${usdcMint}`);
  console.log("\nArdından doğrulamak için: pnpm tsx scripts/chain-smoke.ts");
}

main().catch((err) => {
  console.error("❌ Devnet init başarısız:", err);
  process.exit(1);
});

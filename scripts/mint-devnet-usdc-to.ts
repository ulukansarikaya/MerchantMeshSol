/** Mint the project's devnet-only test USDC to a wallet address. */
import { address, createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import {
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getMintToInstruction,
} from "@solana-program/token";
import {
  createSolanaRpcClient,
  deriveAssociatedTokenAddress,
  readSolanaEnvConfig,
  sendAndConfirmInstructions,
} from "../packages/shared/src/index.js";
import { env, loadRootEnv } from "../packages/shared/src/env.js";

loadRootEnv();

const recipientRaw = process.argv[2];
const amountRaw = process.argv[3] ?? "10";
if (!recipientRaw) throw new Error("Usage: pnpm tsx scripts/mint-devnet-usdc-to.ts <wallet> [amount]");
if (!/^\d+(\.\d{1,6})?$/.test(amountRaw)) throw new Error("Amount must have at most 6 decimal places.");

const [whole, fraction = ""] = amountRaw.split(".");
const amountMicro = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
if (amountMicro <= 0n || amountMicro > 100_000_000n) throw new Error("Amount must be between 0 and 100 test USDC.");

const seedHex = env("RELAYER_PRIVATE_KEY").replace(/^0x/, "");
const seed = Uint8Array.from(seedHex.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
const authority = await createKeyPairSignerFromPrivateKeyBytes(seed);
const recipient = address(recipientRaw);
const mint = address(env("USDC_MINT"));
const rpc = createSolanaRpcClient(readSolanaEnvConfig());
const ata = await deriveAssociatedTokenAddress(recipient, mint);

const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
  payer: authority,
  owner: recipient,
  mint,
});
const mintTo = getMintToInstruction({
  mint,
  token: ata,
  mintAuthority: authority,
  amount: amountMicro,
});
const signature = await sendAndConfirmInstructions(rpc, authority, [createAta, mintTo]);

console.log(JSON.stringify({ recipient, mint, ata, amountMicro: amountMicro.toString(), signature }));

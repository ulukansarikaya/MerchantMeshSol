/** Ensure every seeded merchant signer has enough Devnet SOL to submit state transitions. */
import { createKeyPairSignerFromPrivateKeyBytes, lamports } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { createSolanaRpcClient, readSolanaEnvConfig, SEED_MERCHANTS, sendAndConfirmInstructions } from "../packages/shared/src/index.js";
import { env, loadRootEnv } from "../packages/shared/src/env.js";

loadRootEnv();
const rpc = createSolanaRpcClient(readSolanaEnvConfig());

function signerFromEnv(name: string) {
  const hex = env(name).replace(/^0x/, "");
  const bytes = Uint8Array.from(hex.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}

const relayer = await signerFromEnv("RELAYER_PRIVATE_KEY");
const minimum = 20_000_000n; // 0.02 SOL
const target = 50_000_000n; // 0.05 SOL

for (const merchant of SEED_MERCHANTS) {
  const signer = await signerFromEnv(merchant.signerKeyEnv);
  const { value: balance } = await rpc.getBalance(signer.address).send();
  if (balance >= minimum) {
    console.log(`${merchant.name}: ${(Number(balance) / 1e9).toFixed(4)} SOL (ready)`);
    continue;
  }
  const amount = target - balance;
  const signature = await sendAndConfirmInstructions(rpc, relayer, [
    getTransferSolInstruction({ source: relayer, destination: signer.address, amount: lamports(amount) }),
  ]);
  console.log(`${merchant.name}: funded ${(Number(amount) / 1e9).toFixed(4)} SOL (${signature})`);
}

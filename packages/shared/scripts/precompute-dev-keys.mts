// One-off script (not part of the build) — derives the base58 addresses for
// the fixed dev seeds in src/solanaKeys.ts, so those addresses can be
// hardcoded as constants instead of recomputed asynchronously at import
// time. Run with: pnpm exec tsx scripts/precompute-dev-keys.mts
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";

const DEV_KEY_SEEDS: readonly Uint8Array[] = Array.from({ length: 7 }, (_, i) =>
  Uint8Array.from({ length: 32 }, (_, b) => (i * 31 + b * 7 + 11) % 256),
);

for (let i = 0; i < DEV_KEY_SEEDS.length; i++) {
  const signer = await createKeyPairSignerFromPrivateKeyBytes(DEV_KEY_SEEDS[i]!);
  const bytes = Array.from(DEV_KEY_SEEDS[i]!).join(", ");
  console.log(`index ${i}: address=${signer.address}`);
  console.log(`  seed bytes: [${bytes}]`);
}

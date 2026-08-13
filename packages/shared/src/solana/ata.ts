import { fetchMaybeToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { Address, GetAccountInfoApi, Rpc } from "@solana/kit";

export { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

/** The wallet's associated (canonical, discoverable) token account for a given mint. */
export async function deriveAssociatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/** Raw token amount (mint's smallest unit, e.g. micro-USDC) held at a token account; 0n if the account doesn't exist. */
export async function fetchTokenAccountBalance(rpc: Rpc<GetAccountInfoApi>, tokenAccount: Address): Promise<bigint> {
  const account = await fetchMaybeToken(rpc, tokenAccount);
  return account.exists ? account.data.amount : 0n;
}

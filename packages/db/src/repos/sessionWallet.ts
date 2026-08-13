import { eq } from "drizzle-orm";
import type { Db } from "../client.js";
import { sessionWallets } from "../schema/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Faz J §1 — session wallet persistence. Key generation/encryption is the
 * CALLER's job (platform-api, using @solana/kit + @merchantmesh/shared's
 * sessionWalletCrypto) — this repo layer only ever stores/reads the
 * envelope, never touches key material logic itself. Solana addresses are
 * base58 and case-sensitive (unlike EVM hex) — never lowercase them.
 */
export async function getSessionWallet(db: Db, accountId: string) {
  const [row] = await db.select().from(sessionWallets).where(eq(sessionWallets.accountId, accountId)).limit(1);
  return row;
}

export async function createSessionWallet(db: Db, accountId: string, address: string, encryptedKey: string) {
  const [row] = await db.insert(sessionWallets).values({ accountId, address, encryptedKey }).returning();
  return row!;
}

export async function getSessionWalletOwnerByAddress(db: Db, address: string): Promise<string | undefined> {
  const [row] = await db
    .select({ accountId: sessionWallets.accountId })
    .from(sessionWallets)
    .where(eq(sessionWallets.address, address))
    .limit(1);
  return row?.accountId;
}

export class SessionWalletFrozenError extends Error {
  constructor() {
    super("session_wallet_frozen");
  }
}

/**
 * Adds `amountMicro` to the rolling 24h spend counter, resetting it first if
 * the window has elapsed. Throws if the wallet is frozen — callers must
 * check this BEFORE broadcasting a payment, not after.
 */
export async function recordSessionWalletSpend(db: Db, accountId: string, amountMicro: number): Promise<bigint> {
  const wallet = await getSessionWallet(db, accountId);
  if (!wallet) throw new Error(`no session wallet for account ${accountId}`);
  if (wallet.frozenAt) throw new SessionWalletFrozenError();

  const windowElapsed = Date.now() - wallet.dailySpentResetAt.getTime() >= DAY_MS;
  const base = windowElapsed ? 0n : wallet.dailySpentMicro;
  const next = base + BigInt(amountMicro);
  await db
    .update(sessionWallets)
    .set({ dailySpentMicro: next, ...(windowElapsed ? { dailySpentResetAt: new Date() } : {}) })
    .where(eq(sessionWallets.accountId, accountId));
  return next;
}

/** Current daily spend, accounting for a window reset that hasn't been persisted yet. */
export async function currentDailySpend(db: Db, accountId: string): Promise<bigint> {
  const wallet = await getSessionWallet(db, accountId);
  if (!wallet) return 0n;
  const windowElapsed = Date.now() - wallet.dailySpentResetAt.getTime() >= DAY_MS;
  return windowElapsed ? 0n : wallet.dailySpentMicro;
}

export async function freezeSessionWallet(db: Db, accountId: string): Promise<void> {
  await db.update(sessionWallets).set({ frozenAt: new Date() }).where(eq(sessionWallets.accountId, accountId));
}

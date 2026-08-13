import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  accounts,
  agentProfiles,
  agents,
  auditLogs,
  authNonces,
  sessions,
  wallets,
} from "../schema/index.js";

const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createAuthNonce(db: Db): Promise<string> {
  const nonce = randomBytes(16).toString("hex");
  await db.insert(authNonces).values({ nonce, expiresAt: new Date(Date.now() + NONCE_TTL_MS) });
  return nonce;
}

/** Consumes a nonce (marks it used) iff it exists, is unexpired, and unused. Returns whether it was valid. */
export async function consumeAuthNonce(db: Db, nonce: string): Promise<boolean> {
  const [row] = await db.select().from(authNonces).where(eq(authNonces.nonce, nonce)).limit(1);
  if (!row || row.usedAt !== null || row.expiresAt.getTime() < Date.now()) return false;
  await db.update(authNonces).set({ usedAt: new Date() }).where(eq(authNonces.nonce, nonce));
  return true;
}

export interface AccountView {
  accountId: string;
  walletAddress: string;
  agentId: string;
  activeMode: string;
  isNewAccount: boolean;
}

/**
 * Finds the account for a wallet address, or creates account + wallet +
 * agent + agent_profile together. One wallet → one account → one personal
 * agent, always — this is the "logical agent identity" from plans/faz-0.md,
 * not a running model instance. Solana addresses are base58 and
 * case-sensitive (unlike EVM hex) — never lowercase them.
 */
export async function findOrCreateAccountForWallet(db: Db, walletAddress: string): Promise<AccountView> {
  const address = walletAddress;
  const [existingWallet] = await db.select().from(wallets).where(eq(wallets.address, address)).limit(1);
  if (existingWallet) {
    const [agent] = await db.select().from(agents).where(eq(agents.accountId, existingWallet.accountId)).limit(1);
    const [account] = await db.select().from(accounts).where(eq(accounts.id, existingWallet.accountId)).limit(1);
    await db.update(wallets).set({ lastLoginAt: new Date() }).where(eq(wallets.address, address));
    return {
      accountId: existingWallet.accountId,
      walletAddress: address,
      agentId: agent!.id,
      activeMode: account!.activeMode,
      isNewAccount: false,
    };
  }

  const [account] = await db.insert(accounts).values({}).returning();
  await db.insert(wallets).values({ address, accountId: account!.id, lastLoginAt: new Date() });
  const [agent] = await db.insert(agents).values({ accountId: account!.id, name: "Kişisel Agent" }).returning();
  await db.insert(agentProfiles).values({ agentId: agent!.id, prefsJson: {} });

  return {
    accountId: account!.id,
    walletAddress: address,
    agentId: agent!.id,
    activeMode: account!.activeMode,
    isNewAccount: true,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Buffer.from(digest).toString("hex");
}

export interface CreatedSession {
  token: string; // raw token — only ever returned once, never stored
  expiresAt: Date;
}

export async function createSession(db: Db, accountId: string, walletAddress: string, userAgentHash?: string): Promise<CreatedSession> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = await sha256Hex(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ tokenHash, accountId, walletAddress, expiresAt, userAgentHash });
  return { token, expiresAt };
}

export interface SessionAccount {
  accountId: string;
  walletAddress: string;
}

/** Looks up a session by its raw token (hashes it, never queries by raw value). */
export async function lookupSession(db: Db, token: string): Promise<SessionAccount | null> {
  const tokenHash = await sha256Hex(token);
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  db.update(sessions).set({ lastUsedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash)).catch(() => {});
  return { accountId: row.accountId, walletAddress: row.walletAddress };
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
}

export async function setAccountMode(db: Db, accountId: string, mode: "customer" | "merchant"): Promise<void> {
  await db.update(accounts).set({ activeMode: mode }).where(eq(accounts.id, accountId));
}

export async function getAccountView(db: Db, accountId: string): Promise<AccountView | null> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
  if (!account) return null;
  const [wallet] = await db.select().from(wallets).where(eq(wallets.accountId, accountId)).limit(1);
  const [agent] = await db.select().from(agents).where(eq(agents.accountId, accountId)).limit(1);
  return {
    accountId: account.id,
    walletAddress: wallet?.address ?? "",
    agentId: agent!.id,
    activeMode: account.activeMode,
    isNewAccount: false,
  };
}

export async function logAudit(db: Db, action: string, accountId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  await db.insert(auditLogs).values({ accountId, action, detailJson: detail });
}

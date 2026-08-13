import { Hono } from "hono";
import { cors } from "hono/cors";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import {
  address as toAddress,
  createKeyPairSignerFromPrivateKeyBytes,
  getBase58Codec,
  getPublicKeyFromAddress,
  getUtf8Encoder,
  signatureBytes,
  verifySignature,
  type Address,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import { getTransferInstruction } from "@solana-program/token";
import {
  SESSION_COOKIE_NAME,
  createSessionMiddleware,
} from "@merchantmesh/shared/sessionAuth";
import { loadMasterKey, encryptPrivateKey, decryptPrivateKey } from "@merchantmesh/shared/sessionWalletCrypto";
import {
  SolanaAddress,
  SolanaSignature,
  assertTestnetOnly,
  bytesToHex,
  deriveAssociatedTokenAddress,
  fetchTokenAccountBalance,
  hexToBytes,
  sendAndConfirmInstructions,
  SESSION_WALLET_MAX_BALANCE_MICRO,
  SESSION_WALLET_PER_TASK_MICRO,
  SESSION_WALLET_PER_DAY_MICRO,
  MAX_PAYMENTS_PER_TASK,
  MAX_PAID_MERCHANTS,
  type SolanaEnvConfig,
} from "@merchantmesh/shared";
import {
  type Db,
  createAuthNonce,
  consumeAuthNonce,
  findOrCreateAccountForWallet,
  createSession,
  lookupSession,
  revokeSession,
  setAccountMode,
  getAccountView,
  logAudit,
  getSessionWallet,
  createSessionWallet,
  currentDailySpend,
  getSessionWalletOwnerByAddress,
} from "@merchantmesh/db";
import type Redis from "ioredis";
import type { KeyPairSigner } from "@solana/kit";
import { createRateLimiter } from "./rateLimit.js";
import { registerMerchantRoutes, mapMerchantRouteError } from "./merchantRoutes.js";

export interface PlatformApiConfig {
  db: Db;
  rpc: Rpc<SolanaRpcApi>;
  webOrigin: string;
  redis?: Redis; // rate limiting is skipped (not disabled-by-design) when unset, e.g. in tests
  /** Faz J §1 — needed to sign for /session-wallet/withdraw. Omit to disable the session-wallet endpoints (501). */
  chainConfig?: SolanaEnvConfig;
  usdcMint?: Address;
  /** Faz 2/3 — needed to sign merchant on-chain publish/resolve calls. Omit to disable the /merchant-agents, /admin/*, and dispute routes entirely. */
  relayer?: KeyPairSigner;
  /** accountId allowlist for operator-only actions (publish, suspend/activate, dispute resolution). Empty by default — nobody is an operator until configured. */
  operatorAccountIds?: Set<string>;
  merchantsUrl?: string;
}

type AppEnv = { Variables: { accountId: string; walletAddress: string } };

/**
 * Parses the plain-text sign-in message this app issues (see `/auth/nonce` +
 * the shape the web app's WalletWidget builds): not a standardized format
 * like SIWE/SIWS — Solana has no `viem/siwe`-equivalent parser in this
 * dependency set, so the message is a small fixed template this function
 * both produces (implicitly, via its inverse in the web app) and re-parses
 * here to check the domain/nonce/address embedded in it match the request.
 */
function parseSignInMessage(message: string): { domain: string; address: string; nonce: string; issuedAt: string } | undefined {
  const lines = message.split("\n");
  const domain = lines[0]?.match(/^(.+) wants you to sign in with your Solana account:$/)?.[1];
  const address = lines[1];
  const nonce = lines.find((l) => l.startsWith("Nonce: "))?.slice("Nonce: ".length);
  const issuedAt = lines.find((l) => l.startsWith("Issued At: "))?.slice("Issued At: ".length);
  if (!domain || !address || !nonce || !issuedAt) return undefined;
  return { domain, address, nonce, issuedAt };
}

export function createPlatformApp(cfg: PlatformApiConfig) {
  const { db, rpc } = cfg;
  const app = new Hono<AppEnv>();

  app.use("*", cors({ origin: cfg.webOrigin, credentials: true }));

  if (cfg.redis) {
    app.use("/auth/*", createRateLimiter(cfg.redis, { windowSec: 60, max: 10, keyPrefix: "ratelimit:auth" }));
  }

  const sessionRequired = createSessionMiddleware((token) => lookupSession(db, token));

  if (cfg.relayer && cfg.usdcMint) {
    registerMerchantRoutes(
      app,
      {
        db,
        rpc,
        relayer: cfg.relayer,
        usdcMint: cfg.usdcMint,
        operatorAccountIds: cfg.operatorAccountIds ?? new Set(),
        merchantsUrl: cfg.merchantsUrl ?? "http://localhost:4000",
      },
      sessionRequired,
    );
  }

  app.get("/health", (c) => c.json({ ok: true, service: "platform-api" }));

  app.post("/auth/nonce", async (c) => {
    const nonce = await createAuthNonce(db);
    return c.json({ nonce });
  });

  const VerifyBody = z.object({ message: z.string().min(1), signature: SolanaSignature, address: SolanaAddress });

  app.post("/auth/verify", async (c) => {
    const body = VerifyBody.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "invalid_body", issues: body.error.issues }, 400);

    const parsed = parseSignInMessage(body.data.message);
    if (!parsed) return c.json({ error: "invalid_signin_message" }, 400);

    const expectedHost = new URL(cfg.webOrigin).host;
    if (parsed.domain !== expectedHost) return c.json({ error: "domain_mismatch" }, 401);
    if (parsed.address !== body.data.address) return c.json({ error: "address_mismatch" }, 401);

    // Single-use nonce, consumed regardless of what happens next — a nonce
    // can never be retried even if the signature check below fails.
    const nonceValid = await consumeAuthNonce(db, parsed.nonce);
    if (!nonceValid) return c.json({ error: "invalid_or_used_nonce" }, 401);

    const publicKey = await getPublicKeyFromAddress(toAddress(body.data.address));
    const sigBytes = signatureBytes(getBase58Codec().encode(body.data.signature));
    const messageBytes = getUtf8Encoder().encode(body.data.message);
    const validSignature = await verifySignature(publicKey, sigBytes, messageBytes);
    if (!validSignature) return c.json({ error: "invalid_signature" }, 401);

    const accountView = await findOrCreateAccountForWallet(db, body.data.address);
    const session = await createSession(db, accountView.accountId, accountView.walletAddress, c.req.header("user-agent"));
    await logAudit(db, "auth.login", accountView.accountId, {
      walletAddress: accountView.walletAddress,
      newAccount: accountView.isNewAccount,
    });

    setCookie(c, SESSION_COOKIE_NAME, session.token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      expires: session.expiresAt,
    });
    return c.json({ ok: true, account: accountView });
  });

  app.post("/auth/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME) ?? c.req.header("authorization")?.replace(/^Bearer\s+/, "");
    if (token) await revokeSession(db, token);
    deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
    return c.json({ ok: true });
  });

  app.get("/me", sessionRequired, async (c) => {
    const account = await getAccountView(db, c.get("accountId"));
    if (!account) return c.json({ error: "account_not_found" }, 404);
    const isOperator = (cfg.operatorAccountIds ?? new Set()).has(account.accountId);
    return c.json({ account: { ...account, isOperator } });
  });

  const ModeBody = z.object({ mode: z.enum(["customer", "merchant"]) });

  app.post("/me/mode", sessionRequired, async (c) => {
    const body = ModeBody.parse(await c.req.json());
    await setAccountMode(db, c.get("accountId"), body.mode);
    const account = await getAccountView(db, c.get("accountId"));
    return c.json({ ok: true, account });
  });

  // ---------------------------------------------------------------------------
  // Faz J §1 — session wallet: per-account testnet micropayment signer.
  // ---------------------------------------------------------------------------
  async function readUsdcBalance(owner: Address): Promise<number> {
    if (!cfg.usdcMint) return 0;
    const ata = await deriveAssociatedTokenAddress(owner, cfg.usdcMint);
    const balance = await fetchTokenAccountBalance(rpc, ata);
    return Number(balance); // micro-USDC scale (6dp) fits Number safely here
  }

  app.get("/session-wallet", sessionRequired, async (c) => {
    const accountId = c.get("accountId");
    let wallet = await getSessionWallet(db, accountId);
    if (!wallet) {
      // Web Crypto Ed25519 private keys are non-extractable by default, so we
      // generate the raw 32-byte seed ourselves — that's what needs to be
      // encrypted and stored (generateKeyPairSigner()'s key can't be exported).
      const seed = crypto.getRandomValues(new Uint8Array(32));
      const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
      const encryptedKey = encryptPrivateKey(bytesToHex(seed), loadMasterKey());
      wallet = await createSessionWallet(db, accountId, signer.address, encryptedKey);
      await logAudit(db, "session_wallet.created", accountId, { address: signer.address });
    }
    const [balanceMicroUsdc, dailySpentMicro] = await Promise.all([
      readUsdcBalance(toAddress(wallet.address)),
      currentDailySpend(db, accountId),
    ]);
    return c.json({
      address: wallet.address,
      balanceMicroUsdc,
      dailySpentMicroUsdc: Number(dailySpentMicro),
      frozen: wallet.frozenAt !== null,
      limits: {
        maxBalanceMicroUsdc: SESSION_WALLET_MAX_BALANCE_MICRO,
        perTaskMicroUsdc: SESSION_WALLET_PER_TASK_MICRO,
        perDayMicroUsdc: SESSION_WALLET_PER_DAY_MICRO,
        maxPaymentsPerTask: MAX_PAYMENTS_PER_TASK,
        maxPaidMerchantsPerTask: MAX_PAID_MERCHANTS,
      },
    });
  });

  const WithdrawBody = z.object({ to: SolanaAddress });

  app.post("/session-wallet/withdraw", sessionRequired, async (c) => {
    if (!cfg.chainConfig || !cfg.usdcMint) return c.json({ error: "chain_not_configured" }, 501);
    const accountId = c.get("accountId");
    const body = WithdrawBody.parse(await c.req.json());

    // Only the account's OWN registered wallet — never an arbitrary address.
    const account = await getAccountView(db, accountId);
    if (!account || account.walletAddress !== body.to) {
      return c.json({ error: "withdraw_destination_must_be_own_wallet" }, 403);
    }

    const wallet = await getSessionWallet(db, accountId);
    if (!wallet) return c.json({ error: "no_session_wallet" }, 404);
    if (wallet.frozenAt) return c.json({ error: "session_wallet_frozen" }, 403);

    const balance = await readUsdcBalance(toAddress(wallet.address));
    if (balance === 0) return c.json({ ok: true, amountMicroUsdc: 0, txSignature: null });

    assertTestnetOnly(cfg.chainConfig.cluster);
    const seed = hexToBytes(decryptPrivateKey(wallet.encryptedKey, loadMasterKey()));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const source = await deriveAssociatedTokenAddress(signer.address, cfg.usdcMint);
    const destination = await deriveAssociatedTokenAddress(toAddress(body.to), cfg.usdcMint);
    const ix = getTransferInstruction({ source, destination, authority: signer, amount: BigInt(balance) });
    const txSignature = await sendAndConfirmInstructions(rpc, signer, [ix]);
    await logAudit(db, "session_wallet.withdraw", accountId, { to: body.to, amountMicroUsdc: balance, txSignature });
    return c.json({ ok: true, amountMicroUsdc: balance, txSignature });
  });

  // Internal — bridge/merchant-agents resolve a session-wallet address back to
  // its owning account (e.g. to validate a payment's `from`). No session
  // required, matching every other /internal/* endpoint in this codebase
  // (trusted-network assumption, not a public route).
  app.get("/internal/session-wallet-owner", async (c) => {
    const address = c.req.query("address");
    if (!address) return c.json({ error: "address_required" }, 400);
    const accountId = await getSessionWalletOwnerByAddress(db, address);
    if (!accountId) return c.json({ error: "not_found" }, 404);
    return c.json({ accountId });
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: "validation_failed", issues: err.issues }, 400);
    const mapped = mapMerchantRouteError(err);
    if (mapped) return c.json(mapped.body, mapped.status);
    console.error("[platform-api] unhandled error:", err);
    return c.json({ error: "internal_error", detail: (err as Error).message }, 500);
  });

  return app;
}

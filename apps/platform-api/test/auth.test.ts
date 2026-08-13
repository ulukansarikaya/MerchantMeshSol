import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Codec, getUtf8Encoder, signBytes } from "@solana/kit";
import { closeDb, getDb } from "@merchantmesh/db";
import { createSolanaRpcClient, readSolanaEnvConfig } from "@merchantmesh/shared";
import { createPlatformApp } from "../src/app.js";

// Live-DB integration tests — skipped entirely when DATABASE_URL is unset,
// matching packages/db's pattern (see plans/faz-a.md §4). Requires
// SOLANA_RPC_URL too, which .env already provides.
const hasDb = !!process.env.DATABASE_URL;

describe.skipIf(!hasDb)("platform-api — auth (Solana sign-in)", () => {
  const WEB_ORIGIN = "http://localhost:3000";
  let app: ReturnType<typeof createPlatformApp>;

  beforeAll(() => {
    const db = getDb();
    const rpc = createSolanaRpcClient(readSolanaEnvConfig());
    app = createPlatformApp({ db, rpc, webOrigin: WEB_ORIGIN });
  });

  afterAll(async () => {
    await closeDb();
  });

  function buildMessage(domain: string, address: string, nonce: string): string {
    return [
      `${domain} wants you to sign in with your Solana account:`,
      address,
      "",
      "MerchantMesh'e giriş yap.",
      "",
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join("\n");
  }

  async function signIn(seed: Uint8Array = crypto.getRandomValues(new Uint8Array(32))) {
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const nonceRes = await app.request("/auth/nonce", { method: "POST" });
    const { nonce } = (await nonceRes.json()) as { nonce: string };

    const message = buildMessage("localhost:3000", signer.address, nonce);
    const sigBytes = await signBytes(signer.keyPair.privateKey, getUtf8Encoder().encode(message));
    const signature = getBase58Codec().decode(sigBytes);

    const res = await app.request("/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature, address: signer.address }),
    });
    return { res, signer, message, signature, nonce };
  }

  it("verifies a real Solana signature and creates an account + agent", async () => {
    const { res, signer } = await signIn();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.account.walletAddress).toBe(signer.address);
    expect(body.account.isNewAccount).toBe(true);
    expect(body.account.agentId).toBeTruthy();
    expect(res.headers.get("set-cookie")).toMatch(/mm_session=/);
  }, 20_000);

  it("rejects replaying the same signed sign-in message a second time (nonce single-use)", async () => {
    const { res: first, message, signature, signer } = await signIn();
    expect(first.status).toBe(200);

    const replay = await app.request("/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature, address: signer.address }),
    });
    expect(replay.status).toBe(401);
    expect(((await replay.json()) as any).error).toBe("invalid_or_used_nonce");
  }, 20_000);

  it("does NOT create a second account for a second login with the same wallet", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const first = await signIn(seed);
    const firstBody = (await first.res.json()) as any;
    expect(firstBody.account.isNewAccount).toBe(true);

    const second = await signIn(seed);
    const secondBody = (await second.res.json()) as any;
    expect(secondBody.account.isNewAccount).toBe(false);
    expect(secondBody.account.accountId).toBe(firstBody.account.accountId);
    expect(secondBody.account.agentId).toBe(firstBody.account.agentId);
  }, 20_000);

  it("different wallets get different accounts and agents", async () => {
    const a = await signIn();
    const b = await signIn();
    const aBody = (await a.res.json()) as any;
    const bBody = (await b.res.json()) as any;
    expect(aBody.account.accountId).not.toBe(bBody.account.accountId);
    expect(aBody.account.agentId).not.toBe(bBody.account.agentId);
  }, 20_000);

  it("GET /me requires a session and returns the right account for the session's owner", async () => {
    const unauth = await app.request("/me");
    expect(unauth.status).toBe(401);

    const { res } = await signIn();
    const setCookie = res.headers.get("set-cookie")!;
    const token = /mm_session=([^;]+)/.exec(setCookie)![1];

    const me = await app.request("/me", { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as any;
    const verifyBody = (await (await app.request("/me", { headers: { authorization: `Bearer ${token}` } })).json()) as any;
    expect(meBody.account.accountId).toBe(verifyBody.account.accountId);
  }, 20_000);

  it("logout revokes the session — subsequent /me calls 401", async () => {
    const { res } = await signIn();
    const setCookie = res.headers.get("set-cookie")!;
    const token = /mm_session=([^;]+)/.exec(setCookie)![1];

    const before = await app.request("/me", { headers: { authorization: `Bearer ${token}` } });
    expect(before.status).toBe(200);

    const logout = await app.request("/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(logout.status).toBe(200);

    const after = await app.request("/me", { headers: { authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  }, 20_000);

  it("rejects a sign-in message for the wrong domain", async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const nonceRes = await app.request("/auth/nonce", { method: "POST" });
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const message = buildMessage("evil.example", signer.address, nonce); // wrong on purpose
    const sigBytes = await signBytes(signer.keyPair.privateKey, getUtf8Encoder().encode(message));
    const signature = getBase58Codec().decode(sigBytes);
    const res = await app.request("/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature, address: signer.address }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toBe("domain_mismatch");
  }, 20_000);
});

describe.skipIf(hasDb)("platform-api — auth (skipped, no DATABASE_URL)", () => {
  it("is a no-op placeholder", () => {
    expect(true).toBe(true);
  });
});

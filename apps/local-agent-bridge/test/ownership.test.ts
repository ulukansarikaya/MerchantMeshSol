import { afterEach, describe, expect, it } from "vitest";
import { createKeyPairSignerFromPrivateKeyBytes, getBase58Codec, signBytes, getUtf8Encoder } from "@solana/kit";
import {
  closeDb,
  getDb,
  lookupSession,
  getAccountView,
  createPgTaskWithConversation,
  appendSystemEventMessage,
  getPgTaskOwner,
} from "@merchantmesh/db";
import { createSolanaRpcClient, readSolanaEnvConfig } from "@merchantmesh/shared";
import { createPlatformApp } from "../../platform-api/src/app.js";
import { startStack, type Stack } from "./harness.js";

// Faz C ownership tests — live Postgres + live Solana sign-in-message
// signatures, same skip-if-no-DATABASE_URL pattern as packages/db and
// platform-api. See plans/faz-c.md's acceptance criteria: "Sahiplik: A
// hesabının task'ını B hesabı göremiyor."
const hasDb = !!process.env.DATABASE_URL;
const WEB_ORIGIN = "http://localhost:3000";

describe.skipIf(!hasDb)("bridge + platform-api — task ownership (Faz C)", () => {
  let stack: Stack | undefined;

  afterEach(async () => {
    await stack?.close();
    stack = undefined;
    await closeDb().catch(() => {});
  });

  async function signIn(platformApp: ReturnType<typeof createPlatformApp>) {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const nonceRes = await platformApp.request("/auth/nonce", { method: "POST" });
    const { nonce } = (await nonceRes.json()) as { nonce: string };
    const message = [
      "localhost:3000 wants you to sign in with your Solana account:",
      signer.address,
      "",
      "MerchantMesh'e giriş yap.",
      "",
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join("\n");
    const sigBytes = await signBytes(signer.keyPair.privateKey, getUtf8Encoder().encode(message));
    const signature = getBase58Codec().decode(sigBytes);
    const verifyRes = await platformApp.request("/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, signature, address: signer.address }),
    });
    const body = (await verifyRes.json()) as any;
    const setCookie = verifyRes.headers.get("set-cookie")!;
    const token = /mm_session=([^;]+)/.exec(setCookie)![1]!;
    return { token, accountId: body.account.accountId as string, walletAddress: signer.address };
  }

  it("blocks POST /tasks without a session, and blocks account B from reading account A's task", async () => {
    const db = getDb();
    const rpc = createSolanaRpcClient(readSolanaEnvConfig());
    const platformApp = createPlatformApp({ db, rpc, webOrigin: WEB_ORIGIN });

    stack = await startStack({
      webOrigin: WEB_ORIGIN,
      postgres: {
        lookupSession: (token) => lookupSession(db, token),
        getAgentIdForAccount: async (accountId) => (await getAccountView(db, accountId))?.agentId,
        createTaskRecord: (params) => createPgTaskWithConversation(db, params),
        appendSystemEvent: (conversationId, content) => appendSystemEventMessage(db, conversationId, content),
        getTaskOwner: (taskId) => getPgTaskOwner(db, taskId),
      },
    });

    // No session at all → 401, no task created.
    const noAuth = await fetch(`${stack.bridgeUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "4 kişilik köfte yapacağım" }),
    });
    expect(noAuth.status).toBe(401);

    const alice = await signIn(platformApp);
    const bob = await signIn(platformApp);
    expect(alice.accountId).not.toBe(bob.accountId);

    const created = await fetch(`${stack.bridgeUrl}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${alice.token}` },
      body: JSON.stringify({ prompt: "4 kişilik köfte yapacağım, gidip alacağım" }),
    });
    expect(created.status).toBe(201);
    const { taskId } = (await created.json()) as { taskId: string };

    // Owner can read it.
    const asAlice = await fetch(`${stack.bridgeUrl}/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${alice.token}` },
    });
    expect(asAlice.status).toBe(200);

    // A different account cannot — 404, not 403 (don't reveal existence).
    const asBob = await fetch(`${stack.bridgeUrl}/tasks/${taskId}`, {
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(asBob.status).toBe(404);

    // Postgres actually recorded the task under Alice's account + a conversation with her prompt.
    const owner = await getPgTaskOwner(db, taskId);
    expect(owner).toBe(alice.accountId);
  }, 30_000);
});

describe.skipIf(hasDb)("bridge + platform-api — task ownership (skipped, no DATABASE_URL)", () => {
  it("is a no-op placeholder", () => {
    expect(true).toBe(true);
  });
});

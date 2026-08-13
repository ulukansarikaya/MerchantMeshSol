import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { address } from "@solana/kit";
import { env, envBool, envInt, loadRootEnv } from "@merchantmesh/shared/env";
import { readSolanaEnvConfig } from "@merchantmesh/shared";
import { openDb } from "./db.js";
import { TaskEventBus } from "./events.js";
import { createLlmProvider } from "./llmProvider.js";
import { MockPaymentProvider, SolanaPaymentProvider, type PaymentProvider } from "./paymentClient.js";
import { createChainProvider } from "./chain.js";
import { Orchestrator } from "./orchestrator.js";
import { createBridgeApp, type PostgresBridgeSupport } from "./server.js";
import {
  getDb,
  getRedis,
  lookupSession,
  getAccountView,
  createPgTaskWithConversation,
  appendSystemEventMessage,
  getPgTaskOwner,
} from "@merchantmesh/db";

loadRootEnv();

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.BRIDGE_DB_PATH ?? join(here, "..", "data", "bridge.db");
const db = openDb(dbPath);

const bus = new TaskEventBus(db);
const llm = createLlmProvider();

const failSlugs = new Set(
  (process.env.DEMO_FAIL_SHOP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const chain = await createChainProvider(db, failSlugs);

// Faz C — optional live-version wiring. Unset (default) → bridge behaves
// exactly as in mock mode: no auth on /tasks, SQLite only. Faz I §2 reuses
// the same pgDb instance directly (orchestrator needs a much wider Postgres
// surface than the narrow DI functions below cover).
let postgres: PostgresBridgeSupport | undefined;
let orchestratorPg: { db: ReturnType<typeof getDb> } | undefined;
if (process.env.DATABASE_URL) {
  const pgDb = getDb();
  postgres = {
    lookupSession: (token) => lookupSession(pgDb, token),
    getAgentIdForAccount: async (accountId) => (await getAccountView(pgDb, accountId))?.agentId,
    createTaskRecord: (params) => createPgTaskWithConversation(pgDb, params),
    appendSystemEvent: (conversationId, content) => appendSystemEventMessage(pgDb, conversationId, content),
    getTaskOwner: (taskId) => getPgTaskOwner(pgDb, taskId),
  };
  orchestratorPg = { db: pgDb };
  console.log("[bridge] DATABASE_URL set — /tasks now requires a session (Faz C); real merchant acceptance flow active (Faz I).");
}

// Faz J §2 — real research micro-payments from the caller's own session
// wallet. Requires Postgres (accounts/session_wallets) + Redis (nonce lock).
const mockPayments = (process.env.MOCK_PAYMENTS ?? "true") !== "false";
let payments: PaymentProvider;
if (mockPayments) {
  payments = new MockPaymentProvider(db, env("MOCK_PAYMENT_SECRET", "merchantmesh-mock-secret"));
} else {
  if (!orchestratorPg) throw new Error("MOCK_PAYMENTS=false requires DATABASE_URL (session wallets live in Postgres — Faz J).");
  payments = new SolanaPaymentProvider(db, orchestratorPg.db, readSolanaEnvConfig(), address(env("USDC_MINT")), getRedis());
}

const orchestrator = new Orchestrator(
  db,
  bus,
  llm,
  payments,
  chain,
  {
    merchantsUrl: env("MERCHANTS_URL", "http://localhost:4000"),
    budgetTotalMicro: envInt("RESEARCH_BUDGET_TOTAL_MICRO", 10_000),
    budgetPerRequestMicro: envInt("RESEARCH_BUDGET_PER_REQUEST_MICRO", 2_000),
    discoveryRadiusM: envInt("DISCOVERY_RADIUS_M", 1_000),
    releaseDeadlineSecs: envInt("PREP_DEADLINE_SEC", 3600),
    autoAcceptMerchantOrders: envBool("AUTO_ACCEPT_MERCHANT_ORDERS", true),
  },
  orchestratorPg,
);

// Faz I §2 — pending merchant_pending windows past MERCHANT_ACCEPT_WINDOW_SEC
// expire and run the same alternative/drop/cancel saga as an explicit reject.
if (orchestratorPg) {
  const timer = setInterval(() => {
    void orchestrator.acceptanceTimeoutTick().catch((err) => console.error("[bridge] acceptance timeout tick failed:", err));
    void orchestrator.autoAcceptPendingMerchantOrders().catch((err) => console.error("[bridge] merchant auto-accept tick failed:", err));
  }, 5000);
  timer.unref?.();
  void orchestrator.autoAcceptPendingMerchantOrders().catch((err) => console.error("[bridge] initial merchant auto-accept failed:", err));
}

const app = createBridgeApp({ db, bus, orchestrator, chain, postgres, webOrigin: env("WEB_ORIGIN", "http://localhost:3000") });
const port = envInt("BRIDGE_PORT", 3001);

serve({ fetch: app.fetch, port }, () => {
  console.log(
    `[bridge] personal agent on http://localhost:${port} — ai: ${llm.name}, payments: ${mockPayments ? "mock" : "x402"}, chain: ${chain.mode}`,
  );
  if (failSlugs.size > 0) console.log(`[bridge] DEMO_FAIL_SHOP active: ${[...failSlugs].join(", ")}`);
});

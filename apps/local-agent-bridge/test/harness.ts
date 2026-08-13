import { serve, type ServerType } from "@hono/node-server";
import { openDb as openBridgeDb } from "../src/db.js";
import { TaskEventBus } from "../src/events.js";
import { MockLlmProvider } from "../src/llmProvider.js";
import { MockPaymentProvider } from "../src/paymentClient.js";
import { MockChainProvider } from "../src/chain.js";
import { Orchestrator, type OrchestratorPostgresSupport } from "../src/orchestrator.js";
import { createBridgeApp, type PostgresBridgeSupport } from "../src/server.js";
import { openDb as openMerchantDb, seedDb } from "../../merchant-agents/src/db.js";
import { createMerchantApp } from "../../merchant-agents/src/app.js";
import { MockChainClient } from "../../merchant-agents/src/chainClient.js";
import { MockDiscountProvider } from "../../merchant-agents/src/discountProvider.js";
import { getDb } from "@merchantmesh/db";

const SECRET = "harness-secret";

export interface Stack {
  orchestrator: Orchestrator;
  bus: TaskEventBus;
  bridgeDb: ReturnType<typeof openBridgeDb>;
  merchantDb: ReturnType<typeof openMerchantDb>;
  merchantWorker: { tick(): Promise<{ expiredQuotes: number; releasedReservations: number; refundedOrders: number }> };
  merchantsUrl: string;
  bridgeUrl: string;
  chain: MockChainProvider;
  payments: MockPaymentProvider;
  close(): Promise<void>;
}

function listen(fetch: any, port: number): Promise<ServerType> {
  return new Promise((resolve) => {
    const server = serve({ fetch, port }, () => resolve(server));
  });
}

let portCursor = 42000 + Math.floor(Math.random() * 5000);

/** Boots merchant-agents + bridge in-process on local ports (also used by pnpm demo). */
export async function startStack(opts: {
  failSlugs?: string[];
  prepTimeoutShop?: string;
  prepTimeoutSecs?: number;
  budgetTotalMicro?: number;
  budgetPerRequestMicro?: number;
  autoPrepareDelayMs?: number;
  /** Faz C — pass to test session auth + task ownership against a live Postgres. */
  postgres?: PostgresBridgeSupport;
  webOrigin?: string;
  /** Faz I §2 — wires the orchestrator's real merchant-acceptance path to a live Postgres. */
  orchestratorPostgres?: boolean;
} = {}): Promise<Stack> {
  const merchantPort = portCursor++;
  const bridgePort = portCursor++;
  const merchantsUrl = `http://localhost:${merchantPort}`;
  const bridgeUrl = `http://localhost:${bridgePort}`;

  const merchantDb = openMerchantDb(":memory:");
  await seedDb(merchantDb, false); // false: ignore any real MERCHANT_*_PRIVATE_KEY in env, use deterministic dev keys
  const { app: merchantApp, worker } = createMerchantApp({
    db: merchantDb,
    chain: new MockChainClient(bridgeUrl),
    mockPayments: true,
    mockSecret: SECRET,
    bridgeUrl,
    notifyBridge: true,
    chainName: "mock",
    usdcAsset: "USDC",
    demoPrepTimeoutShop: opts.prepTimeoutShop,
    prepTimeoutSecs: opts.prepTimeoutSecs ?? 2,
    autoPrepareDelayMs: opts.autoPrepareDelayMs ?? 10,
    discountProvider: new MockDiscountProvider(),
  });

  const bridgeDb = openBridgeDb(":memory:");
  const bus = new TaskEventBus(bridgeDb);
  const payments = new MockPaymentProvider(bridgeDb, SECRET);
  const chain = new MockChainProvider(bridgeDb, new Set(opts.failSlugs ?? []));
  const orchestratorPg: OrchestratorPostgresSupport | undefined = opts.orchestratorPostgres ? { db: getDb() } : undefined;
  const orchestrator = new Orchestrator(
    bridgeDb,
    bus,
    new MockLlmProvider(),
    payments,
    chain,
    {
      merchantsUrl,
      budgetTotalMicro: opts.budgetTotalMicro ?? 10_000,
      budgetPerRequestMicro: opts.budgetPerRequestMicro ?? 2_000,
      discoveryRadiusM: 1_000,
    },
    orchestratorPg,
  );
  const bridgeApp = createBridgeApp({ db: bridgeDb, bus, orchestrator, chain, postgres: opts.postgres, webOrigin: opts.webOrigin });

  const merchantServer = await listen(merchantApp.fetch, merchantPort);
  const bridgeServer = await listen(bridgeApp.fetch, bridgePort);

  return {
    orchestrator,
    bus,
    bridgeDb,
    merchantDb,
    merchantWorker: worker,
    merchantsUrl,
    bridgeUrl,
    chain,
    payments,
    close: async () => {
      worker.stop();
      await new Promise<void>((r) => merchantServer.close(() => r()));
      await new Promise<void>((r) => bridgeServer.close(() => r()));
    },
  };
}

export async function until<T>(fn: () => T | Promise<T>, timeoutMs = 8000, label = "condition"): Promise<T> {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

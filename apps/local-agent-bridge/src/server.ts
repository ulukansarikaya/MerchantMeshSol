import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { Feedback, HOME_POINT, OptionKind } from "@merchantmesh/shared";
import { createSessionMiddleware, type SessionLookup } from "@merchantmesh/shared/sessionAuth";
import type { BridgeDb } from "./db.js";
import type { TaskEventBus } from "./events.js";
import type { Orchestrator } from "./orchestrator.js";
import type { ChainProvider } from "./chain.js";

/**
 * Faz C — optional live-version support. When set, `POST /tasks` requires a
 * session and mirrors the task + first prompt into Postgres (accounts,
 * conversations); ownership then gates `GET /tasks/:id*`. When unset (the
 * default — every existing mock test and `pnpm demo` run this way), the
 * bridge behaves exactly as before: no auth, SQLite only. See plans/faz-c.md §3.
 */
export interface PostgresBridgeSupport {
  lookupSession: SessionLookup;
  getAgentIdForAccount: (accountId: string) => Promise<string | undefined>;
  createTaskRecord: (params: {
    taskId: string;
    accountId: string;
    agentId: string;
    walletAddress: string;
    prompt: string;
    lat: number;
    lng: number;
    budgetTotalMicro: number;
    budgetPerRequestMicro: number;
  }) => Promise<{ conversationId: string }>;
  appendSystemEvent: (conversationId: string, content: string) => Promise<void>;
  getTaskOwner: (taskId: string) => Promise<string | undefined>;
}

export interface BridgeServerDeps {
  db: BridgeDb;
  bus: TaskEventBus;
  orchestrator: Orchestrator;
  chain: ChainProvider;
  postgres?: PostgresBridgeSupport;
  /** Required (and used for CORS) when `postgres` is set — session cookies need a fixed, non-wildcard origin. */
  webOrigin?: string;
}

type AppEnv = { Variables: { accountId?: string; walletAddress?: string } };

export function createBridgeApp({ bus, orchestrator, chain, postgres, webOrigin }: BridgeServerDeps) {
  const app = new Hono<AppEnv>();
  // Session cookies (Faz C) require a fixed origin + credentials — never a
  // wildcard/echo-origin once Postgres auth is wired. Without Postgres, CORS
  // stays wide open (no cookies involved), matching the mock-mode default.
  app.use("*", postgres ? cors({ origin: webOrigin ?? "http://localhost:3000", credentials: true }) : cors());

  // No-op when Postgres isn't wired — every route behaves exactly as before.
  const sessionMw = postgres
    ? createSessionMiddleware((token) => postgres.lookupSession(token))
    : async (_c: unknown, next: () => Promise<void>) => next();

  /** 404s (not 403 — don't reveal existence) if the task belongs to a Postgres account that isn't the caller's. */
  async function assertOwnedOrPublic(c: { get: (k: "accountId") => string | undefined; json: (b: unknown, s: number) => Response }, taskId: string): Promise<Response | undefined> {
    if (!postgres) return undefined;
    const ownerAccountId = await postgres.getTaskOwner(taskId);
    if (ownerAccountId === undefined) return undefined; // not a Postgres-tracked task — legacy/mock, stays open
    if (ownerAccountId !== c.get("accountId")) return c.json({ error: "task_not_found" }, 404);
    return undefined;
  }

  app.get("/health", (c) => c.json({ ok: true, service: "local-agent-bridge", chain: chain.mode }));

  app.get("/wallet", async (c) =>
    c.json({
      address: chain.walletAddress(),
      balanceMicroUsdc: await chain.walletBalanceMicroUsdc(),
      mode: chain.mode,
      note: "Mock session wallet — in real mode micropayments come from a session wallet funded once; only final escrow funding uses the connected wallet.",
    }),
  );

  // ---------------------------------------------------------------------------
  // Tasks
  // ---------------------------------------------------------------------------
  const CreateTaskBody = z.object({
    prompt: z.string().min(3).max(500),
    lat: z.number().min(-90).max(90).default(HOME_POINT.lat),
    lng: z.number().min(-180).max(180).default(HOME_POINT.lng),
  });

  app.post("/tasks", sessionMw, async (c) => {
    const body = CreateTaskBody.parse(await c.req.json());
    const taskId = orchestrator.createTask(body.prompt, body.lat, body.lng);

    if (postgres) {
      const accountId = c.get("accountId")!; // sessionMw is `required: true` by default — guaranteed set here
      const walletAddress = c.get("walletAddress")!;
      const agentId = await postgres.getAgentIdForAccount(accountId);
      const task = orchestrator.getTask(taskId)!;
      const { conversationId } = await postgres.createTaskRecord({
        taskId,
        accountId,
        agentId: agentId!,
        walletAddress,
        prompt: body.prompt,
        lat: body.lat,
        lng: body.lng,
        budgetTotalMicro: task.budget_total_micro,
        budgetPerRequestMicro: task.budget_per_request_micro,
      });
      // Log the two structural milestones as system_event conversation
      // messages — the full paid-timeline transcript is Faz K's job.
      bus.subscribe(taskId, (event) => {
        if (event.type === "options_ready" || event.type === "receipt_ready") {
          void postgres
            .appendSystemEvent(conversationId, JSON.stringify({ type: event.type, ...event.data }).slice(0, 4000))
            .catch((err) => console.error("[bridge] failed to append conversation event:", err));
        }
      });
    }

    void orchestrator.preparePlan(taskId); // paid merchant research waits for list approval
    return c.json({ taskId }, 201);
  });

  app.post("/tasks/:id/refine-plan", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    const body = z.object({ message: z.string().min(2).max(500) }).parse(await c.req.json());
    const task = orchestrator.getTask(taskId);
    if (!task || task.status !== "awaiting_list_approval") return c.json({ error: "task_not_awaiting_list_approval" }, 409);
    void orchestrator.preparePlan(taskId, body.message);
    return c.json({ ok: true });
  });

  app.post("/tasks/:id/approve-plan", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    const task = orchestrator.getTask(taskId);
    if (!task || task.status !== "awaiting_list_approval" || !task.plan_json) return c.json({ error: "plan_not_ready" }, 409);
    const body = z.object({
      selectedIndices: z.array(z.number().int().nonnegative()).min(1).max(20),
    }).parse(await c.req.json());
    orchestrator.approvePlan(taskId, [...new Set(body.selectedIndices)]);
    return c.json({ ok: true });
  });

  app.get("/tasks/:id", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    const snapshot = await orchestrator.taskSnapshot(taskId);
    if (!snapshot) return c.json({ error: "task_not_found" }, 404);
    return c.json(snapshot);
  });

  app.get("/tasks/:id/spend", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    if (!orchestrator.getTask(taskId)) return c.json({ error: "task_not_found" }, 404);
    return c.json(orchestrator.budgetSummary(taskId));
  });

  /** SSE timeline: replays history, then streams live events. */
  app.get("/tasks/:id/events", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    if (!orchestrator.getTask(taskId)) return c.json({ error: "task_not_found" }, 404);
    const lastEventId = Number(c.req.header("last-event-id") ?? 0) || 0;

    return streamSSE(c, async (stream) => {
      let open = true;
      const send = (event: { seq: number; type: string; ts: number; data: Record<string, unknown> }) =>
        stream.writeSSE({
          id: String(event.seq),
          event: event.type,
          data: JSON.stringify({ ts: event.ts, ...event.data }),
        });

      for (const event of bus.history(taskId, lastEventId)) await send(event);

      const queue: Parameters<typeof send>[0][] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = bus.subscribe(taskId, (event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        wake?.();
      });

      while (open) {
        while (queue.length > 0) await send(queue.shift()!);
        await Promise.race([
          new Promise<void>((resolve) => (wake = resolve)),
          new Promise((resolve) => setTimeout(resolve, 15_000)),
        ]);
        wake = undefined;
        if (open && queue.length === 0) {
          await stream.writeSSE({ event: "heartbeat", data: String(Date.now()) });
        }
      }
    });
  });

  const SelectBody = z.object({ option: OptionKind });

  app.post("/tasks/:id/select-option", async (c) => {
    const body = SelectBody.parse(await c.req.json());
    orchestrator.selectOption(c.req.param("id"), body.option);
    return c.json({ ok: true });
  });

  app.post("/tasks/:id/approve-payment", async (c) => {
    const taskId = c.req.param("id");
    const task = orchestrator.getTask(taskId);
    if (!task) return c.json({ error: "task_not_found" }, 404);
    void orchestrator.approvePayment(taskId); // saga runs async; watch SSE
    return c.json({ ok: true });
  });

  app.post("/tasks/:id/cancel", async (c) => {
    await orchestrator.cancelTask(c.req.param("id"), "user cancel (fallback)");
    return c.json({ ok: true });
  });

  const ReleaseBody = z.object({ orderId: z.string() });

  app.post("/tasks/:id/user-release", async (c) => {
    const body = ReleaseBody.parse(await c.req.json());
    const result = await orchestrator.userRelease(c.req.param("id"), body.orderId);
    return c.json({ ok: true, ...result });
  });

  // Faz I §4 — the browser reports a fund() tx it signed with the user's own
  // wallet; the bridge only ever verifies it against on-chain state, never
  // signs on the user's behalf (see orchestrator.verifyFunding).
  const FundingTxBody = z.object({ orderId: z.string(), escrowOrderId: z.number().int(), txSignature: z.string() });

  app.post("/tasks/:id/funding-tx", async (c) => {
    const body = FundingTxBody.parse(await c.req.json());
    const result = await orchestrator.verifyFunding(c.req.param("id"), body.orderId, body.escrowOrderId, body.txSignature);
    if (!result.ok) return c.json({ error: result.error }, 422);
    return c.json({ ok: true });
  });

  const ReleaseTxBody = z.object({ orderId: z.string(), escrowOrderId: z.number().int().nonnegative(), txSignature: z.string() });

  app.post("/tasks/:id/release-tx", sessionMw, async (c) => {
    const taskId = c.req.param("id");
    const denied = await assertOwnedOrPublic(c, taskId);
    if (denied) return denied;
    const body = ReleaseTxBody.parse(await c.req.json());
    const result = await orchestrator.verifyUserRelease(taskId, body.orderId, body.escrowOrderId, body.txSignature);
    if (!result.ok) return c.json({ error: result.error }, 422);
    return c.json({ ok: true });
  });

  const FeedbackBody = z.object({ entries: z.array(Feedback).min(1) });

  app.post("/tasks/:id/feedback", async (c) => {
    const body = FeedbackBody.parse(await c.req.json());
    const result = await orchestrator.submitFeedback(c.req.param("id"), body.entries);
    return c.json({ ok: true, ...result });
  });

  // ---------------------------------------------------------------------------
  // Internal: merchant → bridge order state notifications
  // ---------------------------------------------------------------------------
  const OrderEventBody = z.object({
    taskId: z.string(),
    orderId: z.string(),
    state: z.string(),
    txRef: z.string().optional(),
    note: z.string().optional(),
  });

  app.post("/internal/order-events", async (c) => {
    const body = OrderEventBody.parse(await c.req.json());
    await orchestrator.handleOrderEvent(body);
    return c.json({ ok: true });
  });

  // Faz I §2 — merchant-agents' console accept/reject calls back here.
  const AcceptanceResolvedBody = z.object({
    taskId: z.string(),
    merchantSlug: z.string(),
    orderId: z.string(),
    decision: z.enum(["accepted", "rejected"]),
    reason: z.string().optional(),
  });

  app.post("/internal/acceptance-resolved", async (c) => {
    const body = AcceptanceResolvedBody.parse(await c.req.json());
    await orchestrator.resolveMerchantAcceptance(body);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Mock chain endpoints — merchants "submit txs" here in mock mode
  // ---------------------------------------------------------------------------
  const EscrowIdBody = z.object({ escrowOrderId: z.number().int() });

  app.post("/chain/mark-preparing", async (c) => {
    const body = EscrowIdBody.parse(await c.req.json());
    return c.json(await chain.markPreparing(body.escrowOrderId));
  });

  app.post("/chain/mark-ready", async (c) => {
    const body = EscrowIdBody.parse(await c.req.json());
    return c.json(await chain.markReady(body.escrowOrderId));
  });

  const ConfirmBody = z.object({ escrowOrderId: z.number().int(), code: z.string() });

  app.post("/chain/confirm-pickup", async (c) => {
    const body = ConfirmBody.parse(await c.req.json());
    return c.json(await chain.confirmPickup(body.escrowOrderId, body.code));
  });

  const RefundBody = z.object({ escrowOrderId: z.number().int(), reason: z.string().default("timeout") });

  app.post("/chain/refund", async (c) => {
    const body = RefundBody.parse(await c.req.json());
    return c.json(await chain.refund(body.escrowOrderId, body.reason));
  });

  app.get("/chain/escrow/:id", async (c) => {
    const escrow = await chain.getEscrow(Number(c.req.param("id")));
    if (!escrow) return c.json({ error: "escrow_not_found" }, 404);
    return c.json(escrow);
  });

  app.onError((err, c) => {
    if (err instanceof z.ZodError) {
      return c.json({ error: "validation_failed", issues: err.issues }, 400);
    }
    const message = (err as Error).message;
    // Domain errors from the orchestrator/chain are client errors, not 500s.
    if (/not found|cannot |invalid |only allowed|already settled|not available/i.test(message)) {
      return c.json({ error: message }, 400);
    }
    console.error("[bridge] unhandled error:", err);
    return c.json({ error: "internal_error", detail: message }, 500);
  });

  return app;
}

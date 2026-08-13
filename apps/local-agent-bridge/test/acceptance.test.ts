import { afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  getDb,
  closeDb,
  listTaskOrdersForTask,
  getEscrowByTaskOrder,
  getMerchantOrgIdBySlug,
  getMerchantOrgSlugById,
  getTaskOrder,
  accounts,
  agents,
  tasks,
} from "@merchantmesh/db";
import { seedMerchantBySlug } from "@merchantmesh/shared";
import { startStack, until, type Stack } from "./harness.js";

const KOFTE_PROMPT = "4 kişilik köfte yapacağım, gidip alacağım";

// Faz I §2 — real merchant acceptance flow against a live Postgres. Skipped
// entirely when DATABASE_URL is unset (matches packages/db's pattern);
// assumes `pnpm db:seed:pg` has been run RECENTLY. cem-firin's ekmek stock
// is only 2 units in the seed data, and this suite can drive it to zero
// across repeated runs (the alternative-merchant saga consumes it) — re-run
// `pnpm db:seed:pg` if this file starts failing on a shared dev Postgres.
const hasDb = !!process.env.DATABASE_URL;

let stack: Stack | undefined;

afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

afterAll(async () => {
  if (hasDb) await closeDb();
});

/**
 * The harness's orchestrator only creates the SQLite `tasks` row (it isn't
 * wired to Faz C's `postgres` session/task-mirror support here, just Faz
 * I's `orchestratorPostgres` flag) — but `task_orders.task_id` FKs to
 * Postgres `tasks.id`. In production this row always exists by the time
 * approvePayment runs (Faz C's POST /tasks writes it on task creation); this
 * helper reproduces that precondition directly for the test.
 */
async function mirrorTaskIntoPostgres(taskId: string): Promise<void> {
  const db = getDb();
  const [account] = await db.insert(accounts).values({}).returning();
  const [agent] = await db.insert(agents).values({ accountId: account!.id }).returning();
  await db.insert(tasks).values({
    id: taskId,
    accountId: account!.id,
    agentId: agent!.id,
    prompt: KOFTE_PROMPT,
    budgetTotalMicro: 10_000n,
    budgetPerRequestMicro: 2_000n,
  });
}

describe.skipIf(!hasDb)("Faz I §2 — merchant_pending → merchant_confirmed acceptance flow", () => {
  it(
    "2 shops accept, 1 rejects → alternative-merchant saga → every remaining shop reaches awaiting_funding with a real escrow row",
    async () => {
      stack = await startStack({ orchestratorPostgres: true });
      const taskId = stack.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
      await stack.orchestrator.runResearch(taskId);
      expect(stack.orchestrator.getTask(taskId)!.status).toBe("options_ready");
      await mirrorTaskIntoPostgres(taskId);

      // Ekmek is stocked by both cem-firin and mini-market — whichever one
      // "cheapest" actually picked (price/stock can vary run to run against
      // a shared dev Postgres), reject IT specifically so the alternative-
      // merchant saga has to fail over to the other one.
      const snap = await stack.orchestrator.taskSnapshot(taskId);
      const cheapest = snap!.options.find((o: any) => o.kind === "cheapest")!;
      const ekmekShop = cheapest.shops.find((s: any) => s.items.some((i: any) => i.sku === "ekmek"))!;
      const rejectSlug: string = ekmekShop.merchantSlug;
      const alternativeSlug = rejectSlug === "cem-firin" ? "mini-market" : "cem-firin";

      stack.orchestrator.selectOption(taskId, "cheapest");
      await stack.orchestrator.approvePayment(taskId);
      expect(stack.orchestrator.getTask(taskId)!.status).toBe("awaiting_merchant");

      const db = getDb();
      let rejectedOnce = false;

      // Drive the console like a real merchant would: reject the ekmek shop
      // once, accept everyone else, repeat until nothing is pending anymore.
      await until(
        async () => {
          const res = await fetch(`${stack!.merchantsUrl}/console/acceptances`);
          const { acceptances } = (await res.json()) as {
            acceptances: { acceptanceId: string; merchantSlug: string; orderId: string }[];
          };
          if (acceptances.length === 0) {
            const task = stack!.orchestrator.getTask(taskId)!;
            return task.status === "awaiting_funding" || task.status === "failed";
          }
          for (const a of acceptances) {
            const reject = a.merchantSlug === rejectSlug && !rejectedOnce;
            if (reject) rejectedOnce = true;
            await fetch(`${stack!.merchantsUrl}/console/acceptances/${a.acceptanceId}/${reject ? "reject" : "accept"}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: reject ? JSON.stringify({ reason: "kapalıyız" }) : undefined,
            });
          }
          return false;
        },
        15_000,
        "acceptance flow to settle",
      );

      expect(rejectedOnce).toBe(true);
      const task = stack.orchestrator.getTask(taskId)!;
      expect(task.status).toBe("awaiting_funding");

      const orders = await listTaskOrdersForTask(db, taskId);
      const confirmed = orders.filter((o) => o.state === "awaiting_funding");
      expect(confirmed.length).toBeGreaterThanOrEqual(3); // butcher, greengrocer, market(s)

      // The rejected merchant has no confirmed order; the alternative picked up ekmek instead.
      const rejectedId = await getMerchantOrgIdBySlug(db, rejectSlug);
      expect(confirmed.some((o) => o.merchantId === rejectedId)).toBe(false);
      const alternativeId = await getMerchantOrgIdBySlug(db, alternativeSlug);
      expect(confirmed.some((o) => o.merchantId === alternativeId)).toBe(true);

      for (const order of confirmed) {
        const escrow = await getEscrowByTaskOrder(db, order.id);
        expect(escrow, `escrow row for order ${order.id}`).toBeTruthy();
        expect(escrow!.state).toBe("awaiting_funding");
        expect(escrow!.amountMicroUsdc).toBeGreaterThan(0n);
        expect(escrow!.pickupCodeHash).toMatch(/^[0-9a-fA-F]{64}$/);
      }

      // Faz I §4 — simulate the browser wallet's fund() call (MockChainProvider
      // stands in for the real writeContract the user's own wallet would sign)
      // and verify the bridge only ever cross-checks the resulting on-chain
      // state, never signs anything itself.
      const fundOrder = confirmed[0]!;
      const fundEscrow = (await getEscrowByTaskOrder(db, fundOrder.id))!;
      const fundMerchantSlug = (await getMerchantOrgSlugById(db, fundOrder.merchantId))!;
      const { escrowOrderId, txRef } = await stack.chain.fund({
        merchantId: seedMerchantBySlug(fundMerchantSlug).merchantId,
        merchantSlug: fundMerchantSlug,
        buyer: fundEscrow.buyerAddress,
        amountMicroUsdc: Number(fundEscrow.amountMicroUsdc),
        quoteHash: fundEscrow.quoteHash,
        pickupCodeHash: fundEscrow.pickupCodeHash,
        releaseDeadline: Math.floor(fundEscrow.releaseDeadline.getTime() / 1000),
      });
      const verifyResult = await stack.orchestrator.verifyFunding(taskId, fundOrder.id, escrowOrderId, txRef);
      expect(verifyResult.ok).toBe(true);

      const fundedOrder = await getTaskOrder(db, fundOrder.id);
      expect(fundedOrder!.state).toBe("paid_in_escrow");
      const fundedEscrow = await getEscrowByTaskOrder(db, fundOrder.id);
      expect(fundedEscrow!.state).toBe("Funded");
      expect(fundedEscrow!.fundTxHash).toBe(txRef);

      // A tampered escrowOrderId (someone else's funded order) must be rejected.
      const bogus = await stack.orchestrator.verifyFunding(taskId, confirmed[1]!.id, escrowOrderId, txRef);
      expect(bogus.ok).toBe(false);

      // Faz I §5 — verifyFunding schedules auto-prepare via /internal/order-funded;
      // once "preparing", the merchant's own ready/verify-pickup dual-path
      // (Postgres task_orders, not the old SQLite `orders` table) takes it
      // all the way to completed + escrow Released.
      const fundingReadyEvent = stack.bus.history(taskId).find((e) => e.type === "funding_ready" && (e.data as any).orderId === fundOrder.id);
      const pickupCode = (fundingReadyEvent!.data as any).pickupCode as string;

      await until(async () => (await getTaskOrder(db, fundOrder.id))!.state === "preparing", 5_000, "order to auto-prepare");

      const pickupRes = await fetch(`${stack.merchantsUrl}/merchant/${fundMerchantSlug}/verify-pickup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: fundOrder.id, code: pickupCode }),
      });
      expect(pickupRes.status).toBe(200);
      const pickupBody = (await pickupRes.json()) as { ok: boolean; state: string; released: boolean };
      expect(pickupBody.state).toBe("completed");
      expect(pickupBody.released).toBe(true);

      const completedOrder = await getTaskOrder(db, fundOrder.id);
      expect(completedOrder!.state).toBe("completed");
      const releasedEscrow = await getEscrowByTaskOrder(db, fundOrder.id);
      expect(releasedEscrow!.state).toBe("Released");
      expect(releasedEscrow!.releaseTxHash).toBeTruthy();
    },
    20_000,
  );

  it("acceptance window timeout runs the same saga as an explicit rejection", async () => {
    stack = await startStack({ orchestratorPostgres: true });
    const taskId = stack.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await stack.orchestrator.runResearch(taskId);
    await mirrorTaskIntoPostgres(taskId);
    stack.orchestrator.selectOption(taskId, "cheapest");
    await stack.orchestrator.approvePayment(taskId);

    const db = getDb();
    // Force every still-pending acceptance to look expired, then run the tick directly
    // (mirrors what the 5s interval in index.ts does, without waiting on it here).
    await db.execute(sql`UPDATE merchant_acceptances SET expires_at = now() - interval '1 second' WHERE task_id = ${taskId} AND status = 'pending'`);
    const expiredCount = await stack.orchestrator.acceptanceTimeoutTick();
    expect(expiredCount).toBeGreaterThan(0);

    const orders = await listTaskOrdersForTask(db, taskId);
    expect(orders.some((o) => o.state === "expired")).toBe(true);
  }, 20_000);
});

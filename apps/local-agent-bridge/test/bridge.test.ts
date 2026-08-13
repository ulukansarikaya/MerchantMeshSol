import { afterEach, describe, expect, it } from "vitest";
import { startStack, until, type Stack } from "./harness.js";

const KOFTE_PROMPT = "4 kişilik köfte yapacağım, gidip alacağım";
let stack: Stack | undefined;

afterEach(async () => {
  await stack?.close();
  stack = undefined;
});

describe("M4 — headless plan → options (AI_PROVIDER=mock)", () => {
  it("runs the full research pipeline and builds 3 options", async () => {
    stack = await startStack();
    const taskId = stack.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await stack.orchestrator.runResearch(taskId);

    const snapshot = (await stack.orchestrator.taskSnapshot(taskId))!;
    expect(snapshot.status).toBe("options_ready");
    expect(snapshot.plan.items).toHaveLength(6);
    expect(snapshot.discovery).toHaveLength(5);

    const kinds = snapshot.options.map((o: any) => o.kind);
    expect(kinds).toEqual(["cheapest", "best_quality", "pickup_optimized"]);

    const cheapest = snapshot.options[0];
    const bestQuality = snapshot.options[1];
    const pickup = snapshot.options[2];

    // Can is cheaper, Ali is better — the quality-score micro-action's reason to exist.
    expect(cheapest.shops.some((s: any) => s.merchantSlug === "can-kasap")).toBe(true);
    expect(bestQuality.shops.some((s: any) => s.merchantSlug === "ali-kasap")).toBe(true);
    expect(bestQuality.totalMicroUsdc).toBeGreaterThan(cheapest.totalMicroUsdc);
    // Pickup-optimized merges bakery+market into Mini → fewer stops.
    expect(pickup.stops).toBeLessThan(bestQuality.stops);

    const events = stack.bus.history(taskId).map((e) => e.type);
    expect(events).toContain("quality_scored");
    expect(events).toContain("negotiation_success");
    expect(events).toContain("reservation_made");

    // Zeynep's negotiated quote is used in every option.
    const negotiation = stack.bus.history(taskId).find((e) => e.type === "negotiation_success")!;
    expect(negotiation.data.merchant).toBe("zeynep-manav");
    for (const option of snapshot.options) {
      const zeynepShop = option.shops.find((s: any) => s.merchantSlug === "zeynep-manav");
      expect(zeynepShop.quoteId).toBe(negotiation.data.newQuoteId);
    }

    // Research budget respected end to end.
    expect(snapshot.budget.spentMicroUsdc).toBeLessThanOrEqual(snapshot.budget.totalMicroUsdc);
  }, 20_000);
});

describe("M3 — research budget enforcement", () => {
  it("blocks micropayments once the total budget is exhausted", async () => {
    stack = await startStack({ budgetTotalMicro: 1_200 }); // only 2 quotes fit
    const taskId = stack.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await stack.orchestrator.runResearch(taskId);

    const budget = stack.payments.budget(taskId);
    expect(budget.spentMicroUsdc).toBeLessThanOrEqual(1_200);
    const events = stack.bus.history(taskId).map((e) => e.type);
    expect(events).toContain("budget_blocked");
  }, 20_000);

  it("blocks any single payment above the per-request cap", async () => {
    stack = await startStack({ budgetPerRequestMicro: 400 }); // below the 500 quote fee
    const taskId = stack.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await stack.orchestrator.runResearch(taskId);

    const blocked = stack.bus.history(taskId).filter((e) => e.type === "budget_blocked");
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]!.data.kind).toBe("per_request");
    expect(stack.payments.budget(taskId).spentMicroUsdc).toBe(0);
  }, 20_000);
});

describe("M5 — approval → escrow → pickup release → receipt (happy path + saga)", () => {
  async function driveMerchantsToCompletion(s: Stack, taskId: string): Promise<void> {
    // Wait for auto-prepare to move every funded order to preparing.
    await until(async () => {
      const snap = (await s.orchestrator.taskSnapshot(taskId))!;
      const open = snap.orders.filter((o: any) => o.state === "paid_in_escrow");
      return open.length === 0;
    }, 8000, "orders preparing");
    const snap = (await s.orchestrator.taskSnapshot(taskId))!;
    for (const order of snap.orders.filter((o: any) => o.state === "preparing")) {
      const ready = await fetch(`${s.merchantsUrl}/merchant/${order.merchantSlug}/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId }),
      });
      expect(ready.status).toBe(200);
      const verify = await fetch(`${s.merchantsUrl}/merchant/${order.merchantSlug}/verify-pickup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.orderId, code: order.pickupCode }),
      });
      expect(verify.status).toBe(200);
    }
  }

  it("completes the köfte demo including the scripted mini-market failure", async () => {
    stack = await startStack({ failSlugs: ["mini-market"] });
    const s = stack;
    const taskId = s.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await s.orchestrator.runResearch(taskId);

    s.orchestrator.selectOption(taskId, "best_quality");
    await s.orchestrator.approvePayment(taskId);

    let snap = (await s.orchestrator.taskSnapshot(taskId))!;
    expect(snap.status).toBe("in_progress");
    // Mini Market (ayran, non-essential) dropped via saga — not funded.
    expect(snap.droppedShops).toHaveLength(1);
    expect(snap.droppedShops[0]!.merchantSlug).toBe("mini-market");
    expect(snap.orders).toHaveLength(3);
    // Merchants auto-prepare funded orders, so both states are legitimate here.
    expect(snap.orders.every((o: any) => ["paid_in_escrow", "preparing"].includes(o.state))).toBe(true);

    // Wrong pickup code is rejected before any release.
    const anyOrder = snap.orders[0]!;
    await until(async () => {
      const res = await fetch(`${s.merchantsUrl}/console/orders`);
      const { orders } = (await res.json()) as any;
      return orders.find((o: any) => o.orderId === anyOrder.orderId)?.state === "preparing";
    }, 8000, "auto-prepare");
    const bad = await fetch(`${s.merchantsUrl}/merchant/${anyOrder.merchantSlug}/verify-pickup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: anyOrder.orderId, code: "000000" }),
    });
    expect(bad.status).toBe(422);

    await driveMerchantsToCompletion(s, taskId);

    await until(async () => (await s.orchestrator.taskSnapshot(taskId))!.status === "settled", 8000, "settlement");
    snap = (await s.orchestrator.taskSnapshot(taskId))!;
    const receipt = snap.receipt;
    expect(receipt.completedShops).toBe(3);
    expect(receipt.totalShops).toBe(4);
    expect(receipt.completedItems).toBe(5); // ayran dropped
    expect(receipt.totalItems).toBe(6);
    expect(receipt.shops.find((x: any) => x.merchantSlug === "mini-market")?.status).toBe("dropped");
    expect(receipt.totalResearchMicroUsdc).toBeLessThanOrEqual(10_000);
    expect(receipt.totalMainMicroUsdc).toBeGreaterThan(0);
    expect(receipt.receiptTx).toMatch(/^mock:/);
    expect(receipt.metadataHash).toMatch(/^[0-9a-f]{64}$/);
  }, 30_000);

  it("auto-refunds a shop that never prepares (prep-timeout)", async () => {
    stack = await startStack({ prepTimeoutShop: "cem-firin", prepTimeoutSecs: 1 });
    const s = stack;
    const taskId = s.orchestrator.createTask(KOFTE_PROMPT, 39.9208, 32.8541);
    await s.orchestrator.runResearch(taskId);
    s.orchestrator.selectOption(taskId, "best_quality");
    await s.orchestrator.approvePayment(taskId);

    const walletAfterFunding = await s.chain.walletBalanceMicroUsdc();
    await new Promise((r) => setTimeout(r, 1_200)); // pass the short deadline
    const tick = await s.merchantWorker.tick();
    expect(tick.refundedOrders).toBe(1);

    await until(async () => {
      const snap = (await s.orchestrator.taskSnapshot(taskId))!;
      return snap.orders.find((o: any) => o.merchantSlug === "cem-firin")?.state === "refunded";
    }, 8000, "prep-timeout refund");

    // Refund credited the buyer's session wallet.
    const cem = (await s.orchestrator.taskSnapshot(taskId))!.orders.find((o: any) => o.merchantSlug === "cem-firin")!;
    expect(await s.chain.walletBalanceMicroUsdc()).toBe(walletAfterFunding + cem.totalMicroUsdc);
  }, 30_000);
});

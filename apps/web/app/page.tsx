"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { skuLabel, usdc } from "../lib/format";
import { platformApi } from "../lib/platformApi";
import { Timeline, type TimelineEvent } from "../components/Timeline";
import { MerchantList } from "../components/MerchantList";
import { QuoteBoard } from "../components/QuoteBoard";
import { OptionsCards } from "../components/OptionsCards";
import { EscrowBoard } from "../components/EscrowBoard";
import { PgOrdersBoard } from "../components/FundingWizard";
import { BudgetGauge } from "../components/BudgetGauge";
import { FeedbackForm } from "../components/FeedbackForm";
import { SessionWalletCard } from "../components/SessionWalletCard";
import { IS_MOCK, useSession } from "../lib/useSession";

const DEMO_PROMPT = "I want to make meatballs for four people and pick up the ingredients";
const ACTIVE_STATUSES = [
  "planning",
  "discovering",
  "quoting",
  "researching",
  "funding",
  "awaiting_merchant",
  "awaiting_funding",
  "in_progress",
];

export default function FlowPage() {
  const { account, loading: sessionLoading } = useSession();
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  // Faz J §4 — an empty research wallet blocks starting a new task in real mode.
  const { data: sessionWallet } = useQuery({
    queryKey: ["session-wallet"],
    queryFn: () => platformApi.sessionWallet(),
    enabled: !IS_MOCK && !!account,
    refetchInterval: 15_000,
  });
  const [prompt, setPrompt] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);

  // Restore the active task after navigating away (e.g. to the merchant console).
  useEffect(() => {
    const saved = window.localStorage.getItem("merchantmesh:taskId");
    if (saved) setTaskId(saved);
  }, []);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listMessage, setListMessage] = useState("");
  const [listBusy, setListBusy] = useState(false);
  const [approvedPlanItemKeys, setApprovedPlanItemKeys] = useState<string[]>([]);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      setSnapshot(await api.task(id));
    } catch {
      /* bridge may briefly be busy */
    }
  }, []);

  // SSE timeline + snapshot refresh on structural events
  useEffect(() => {
    if (!taskId) return;
    const source = new EventSource(api.eventsUrl(taskId), { withCredentials: true });
    sourceRef.current = source;
    const structural = new Set([
      "status", "plan_ready", "discovery_complete", "options_ready", "option_selected",
      "escrow_funded", "shop_dropped", "order_update", "receipt_ready", "task_failed", "task_cancelled",
    ]);
    const onAny = (e: MessageEvent, type: string) => {
      const data = JSON.parse(e.data);
      setEvents((prev) =>
        prev.some((x) => x.seq === Number((e as MessageEvent & { lastEventId: string }).lastEventId))
          ? prev
          : [...prev, { seq: Number((e as MessageEvent & { lastEventId: string }).lastEventId), type, ts: data.ts, data }],
      );
      if (structural.has(type)) void refresh(taskId);
    };
    // EventSource named events: attach a generic handler per known type.
    const types = [
      "task_created", "status", "plan_started", "plan_ready", "discovery_complete", "paid_request",
      "quote_received", "quote_unavailable", "quality_scored", "reservation_made", "negotiation_success",
      "negotiation_declined", "negotiation_skipped", "budget_blocked", "options_ready", "option_selected",
      "approval_received", "escrow_funded", "funding_failed", "saga_alternative", "shop_dropped", "saga_cancel",
      "order_update", "escrow_refunded", "refund_failed", "receipt_ready", "task_failed", "task_cancelled",
      "feedback_posted", "items_unfulfillable",
    ];
    for (const type of types) source.addEventListener(type, (e) => onAny(e as MessageEvent, type));
    void refresh(taskId);
    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [taskId, refresh]);

  // Gentle polling while active (order states advance merchant-side).
  useEffect(() => {
    if (!taskId || !snapshot || !ACTIVE_STATUSES.includes(snapshot.status)) return;
    const timer = setInterval(() => void refresh(taskId), 2000);
    return () => clearInterval(timer);
  }, [taskId, snapshot?.status, refresh, snapshot]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const { taskId: id } = await api.createTask(prompt);
      setEvents([]);
      setSnapshot(null);
      setTaskId(id);
      window.localStorage.setItem("merchantmesh:taskId", id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const newTask = () => {
    sourceRef.current?.close();
    sourceRef.current = null;
    window.localStorage.removeItem("merchantmesh:taskId");
    setTaskId(null);
    setEvents([]);
    setSnapshot(null);
    setError(null);
    setPrompt("");
    setListMessage("");
    setApprovedPlanItemKeys([]);
  };

  const select = async (kind: string) => {
    if (!taskId) return;
    try {
      await api.selectOption(taskId, kind);
      await refresh(taskId);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const refineList = async () => {
    if (!taskId || listMessage.trim().length < 2) return;
    setListBusy(true);
    setError(null);
    try {
      await api.refinePlan(taskId, listMessage.trim());
      setListMessage("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListBusy(false);
    }
  };

  const approveList = async () => {
    if (!taskId || approvedPlanItemKeys.length === 0) return;
    setListBusy(true);
    setError(null);
    try {
      const selectedIndices = planApprovalLines
        .map((line: any, index: number) => (approvedPlanItemKeys.includes(line.key) ? index : -1))
        .filter((index: number) => index >= 0);
      await api.approvePlan(taskId, selectedIndices);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setListBusy(false);
    }
  };

  const approve = async () => {
    if (!taskId) return;
    setApprovalBusy(true);
    setError(null);
    try {
      await api.approvePayment(taskId);
      await refresh(taskId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApprovalBusy(false);
    }
  };

  const status: string = snapshot?.status ?? (taskId ? "planning" : "idle");
  const displayStatus =
    snapshot?.pgOrders?.length > 0 && snapshot.pgOrders.every((order: any) => order.state === "ready" || order.state === "completed")
      ? "ready_for_pickup"
      : status;
  const selectedOption = snapshot?.options?.find((o: any) => o.kind === snapshot.selectedOption);
  const planApprovalLines = (snapshot?.plan?.items ?? []).map((item: any, index: number) => ({
    ...item,
    key: `${item.sku}:${index}`,
  }));
  const planSignature = planApprovalLines.map((line: any) => `${line.key}:${line.qty}`).join("|");
  const completedShops = snapshot?.orders?.filter((o: any) => o.state === "completed") ?? [];

  useEffect(() => {
    setApprovedPlanItemKeys([]);
  }, [taskId, planSignature]);

  const togglePlanItemApproval = (key: string) => {
    setApprovedPlanItemKeys((current) =>
      current.includes(key) ? current.filter((itemKey) => itemKey !== key) : [...current, key],
    );
  };

  if (!IS_MOCK && !sessionLoading && !account) {
    return (
      <section className="card flex flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-xl font-bold">Connect your wallet to start shopping</h1>
        <p className="max-w-md text-sm text-muted">
          MerchantMesh verifies every live account with a wallet signature. Use the wallet button in the top-right and sign
          the login message. Your personal agent will be created automatically.
        </p>
      </section>
    );
  }

  const walletEmpty = !IS_MOCK && !taskId && sessionWallet !== undefined && sessionWallet.balanceMicroUsdc === 0;

  return (
    <div className="flex flex-col gap-4">
      {!IS_MOCK && !taskId && <SessionWalletCard />}

      {/* Prompt */}
      <section className="card flex flex-col gap-3 p-4">
        <h1 className="text-xl font-bold">What are we cooking or shopping for?</h1>
        <p className="text-sm text-muted">
          Describe what you need in English. Your agent builds the list, collects <em>paid</em> quotes from nearby merchant
          agents, negotiates, and presents options. No main purchase payment is made without your approval.
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what you need"
            disabled={!!taskId}
            onKeyDown={(e) => e.key === "Enter" && !taskId && !busy && !walletEmpty && start()}
          />
          <button
            className="btn btn-primary shrink-0"
            onClick={taskId ? newTask : start}
            disabled={busy || (!taskId && (walletEmpty || prompt.trim().length < 3))}
          >
            {taskId ? "New Task" : "Start"}
          </button>
        </div>
        {walletEmpty && (
          <p className="text-sm text-warning">
            Add Devnet USDC to enable paid merchant research. You can prepare your request now.
          </p>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
      </section>

      {taskId && (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-start">
            {snapshot?.budget && <BudgetGauge budget={snapshot.budget} />}
            <div className="badge self-center">
              status: <strong className="ml-1">{displayStatus}</strong>
            </div>
          </div>

          <Timeline events={events} />

          {status === "awaiting_list_approval" && snapshot?.plan && (
            <section className="card flex flex-col gap-3 border-brand p-4">
              <div>
                <h2 className="font-semibold">Chat with your agent and approve the list</h2>
                <p className="text-sm text-muted">
                  Ask for any changes first, then approve every product. Merchant discovery and paid quote requests start only after this list is confirmed.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card-2 p-3">
                <ul className="flex flex-col gap-2 text-sm">
                  {planApprovalLines.map((item: any) => {
                    const checked = approvedPlanItemKeys.includes(item.key);
                    return (
                      <li key={item.key}>
                        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border p-3">
                          <span className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => togglePlanItemApproval(item.key)}
                              disabled={listBusy}
                            />
                            <span className="font-medium">{skuLabel(item.sku)}</span>
                          </span>
                          <span className="flex items-center gap-3">
                            <span className="font-mono">× {item.qty}</span>
                            <span className={`text-xs ${checked ? "text-success" : "text-muted"}`}>
                              {checked ? "Approved" : "Review"}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {snapshot.plan.explanation && <p className="mt-2 text-xs text-muted">{snapshot.plan.explanation}</p>}
              </div>
              <div className="flex gap-2">
                <input
                  className="input"
                  value={listMessage}
                  onChange={(e) => setListMessage(e.target.value)}
                  placeholder="Example: Remove yogurt and make it two loaves of bread"
                  onKeyDown={(e) => e.key === "Enter" && !listBusy && void refineList()}
                />
                <button className="btn" onClick={refineList} disabled={listBusy || listMessage.trim().length < 2}>Send</button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted">
                  {approvedPlanItemKeys.length}/{planApprovalLines.length} products approved
                </p>
                <button className="btn btn-primary" onClick={approveList} disabled={listBusy || approvedPlanItemKeys.length === 0}>
                  Search for {approvedPlanItemKeys.length} Selected Product{approvedPlanItemKeys.length === 1 ? "" : "s"}
                </button>
              </div>
            </section>
          )}

          {snapshot?.discovery && <MerchantList merchants={snapshot.discovery} />}

          <QuoteBoard events={events} />

          {snapshot?.options && (
            <OptionsCards
              options={snapshot.options}
              selected={snapshot.selectedOption}
              canSelect={status === "options_ready" || status === "awaiting_approval"}
              onSelect={select}
            />
          )}

          {status === "awaiting_approval" && selectedOption && (
            <section className="card flex flex-wrap items-center justify-between gap-3 border-brand p-4">
              <div>
                <h2 className="font-semibold">Selected Offer</h2>
                <p className="text-sm text-muted">
                  {selectedOption.label} — <strong className="text-ink">{usdc(selectedOption.totalMicroUsdc)}</strong> total from {selectedOption.stops} merchant(s).
                </p>
                <p className="text-xs text-muted">
                  Your product list was already approved before the search. This confirms the selected price and merchant allocation.
                </p>
              </div>
              <button className="btn btn-primary" onClick={approve} disabled={approvalBusy}>
                {approvalBusy ? "Sending to merchants…" : "Confirm Offer & Request Merchant Approval"}
              </button>
            </section>
          )}

          {!IS_MOCK && taskId && snapshot?.pgOrders && snapshot.pgOrders.length > 0 && (
            <PgOrdersBoard taskId={taskId} orders={snapshot.pgOrders} onChanged={() => refresh(taskId)} />
          )}

          {IS_MOCK && snapshot?.orders && (
            <EscrowBoard
              orders={snapshot.orders}
              droppedShops={snapshot.droppedShops ?? []}
              taskActive={["funding", "in_progress"].includes(status)}
              onUserRelease={(orderId) => taskId && api.userRelease(taskId, orderId).then(() => refresh(taskId))}
              onCancelTask={() => taskId && api.cancelTask(taskId).then(() => refresh(taskId))}
            />
          )}

          {status === "settled" && snapshot?.receipt && (
            <>
              <section className="card flex flex-wrap items-center justify-between gap-3 border-success p-4">
                <div>
                  <h2 className="font-semibold text-success">Shopping completed ✔</h2>
                  <p className="text-sm text-muted">
                    {snapshot.receipt.completedItems}/{snapshot.receipt.totalItems} items ·{" "}
                    {snapshot.receipt.completedShops}/{snapshot.receipt.totalShops} merchants · main payment{" "}
                    {usdc(snapshot.receipt.totalMainMicroUsdc)} · research {usdc(snapshot.receipt.totalResearchMicroUsdc)}
                  </p>
                </div>
                <Link className="btn" href={`/receipt/${taskId}`}>
                  Open Combined Receipt
                </Link>
              </section>
              {completedShops.length > 0 && (
                <FeedbackForm
                  taskId={taskId}
                  shops={completedShops.map((o: any) => ({ merchantId: o.merchantId, merchantName: o.merchantName }))}
                />
              )}
            </>
          )}

          {(status === "failed" || status === "cancelled") && (
            <section className="card border-danger p-4">
              <h2 className="font-semibold text-danger">Task {status === "failed" ? "failed" : "was cancelled"}</h2>
              <p className="text-sm text-muted">{snapshot?.error}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

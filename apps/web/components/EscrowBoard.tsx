"use client";

import { usdc, skuLabel, shortTx, STATE_LABELS } from "../lib/format";

const CHAIN_STEPS = ["paid_in_escrow", "preparing", "ready", "completed"] as const;
const CHAIN_LABELS: Record<string, string> = {
  paid_in_escrow: "Funded",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Released",
};

function StateTimeline({ state }: { state: string }) {
  if (state === "refunded" || state === "cancelled") {
    return <span className="badge text-danger">↩ {STATE_LABELS[state] ?? state}</span>;
  }
  const activeIdx = CHAIN_STEPS.indexOf(state as (typeof CHAIN_STEPS)[number]);
  return (
    <ol className="flex items-center gap-1 text-[11px]">
      {CHAIN_STEPS.map((step, i) => (
        <li key={step} className="flex items-center gap-1">
          <span
            className={`rounded-full border px-2 py-0.5 ${
              i < activeIdx
                ? "border-success/50 text-success"
                : i === activeIdx
                  ? "border-brand text-brand"
                  : "border-border text-muted opacity-60"
            }`}
          >
            {CHAIN_LABELS[step]}
          </span>
          {i < CHAIN_STEPS.length - 1 && <span className="text-muted">→</span>}
        </li>
      ))}
    </ol>
  );
}

export function EscrowBoard({
  orders,
  droppedShops,
  onUserRelease,
  onCancelTask,
  taskActive,
}: {
  orders: any[];
  droppedShops: any[];
  onUserRelease: (orderId: string) => void;
  onCancelTask: () => void;
  taskActive: boolean;
}) {
  if (orders.length === 0 && droppedShops.length === 0) return null;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-title">Escrow Status (per merchant)</h2>
        {taskActive && (
          <button className="btn btn-danger text-xs" onClick={onCancelTask} title="Fallback: cancel all orders and request refunds">
            Fallback: Cancel and Refund
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {orders.map((order) => (
          <li key={order.orderId} className="rounded-lg border border-border bg-card-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{order.merchantName}</span>
                <span className="font-mono text-sm">{usdc(order.totalMicroUsdc)}</span>
                {order.essential && <span className="badge text-warning">★ essential</span>}
              </div>
              <StateTimeline state={order.state} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {order.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")} · escrow #{order.escrowOrderId} ·{" "}
              <span className="font-mono">{shortTx(order.escrowTx)}</span>
              {order.releaseTx && (
                <>
                  {" "}· release <span className="font-mono">{shortTx(order.releaseTx)}</span>
                </>
              )}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {["paid_in_escrow", "preparing", "ready"].includes(order.state) && (
                <>
                  <span className="badge text-brand" title="One-time code to give the merchant at pickup">
                    Pickup code: <strong className="font-mono">{order.pickupCode}</strong>
                  </span>
                  <button
                    className="btn text-xs"
                    onClick={() => onUserRelease(order.orderId)}
                    title="Fallback: manually release funds if code verification is unavailable"
                  >
                    Fallback: Manual Release
                  </button>
                </>
              )}
              {order.note && <span className="text-xs text-muted">— {order.note}</span>}
            </div>
          </li>
        ))}
        {droppedShops.map((d) => (
          <li key={d.merchantSlug} className="rounded-lg border border-dashed border-border p-3 opacity-75">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{d.merchantName}</span>
              <span className="badge text-warning">🪂 removed</span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {d.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")} — {d.reason}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

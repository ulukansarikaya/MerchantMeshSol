"use client";

import { use, useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { usdc, skuLabel, shortTx } from "../../../lib/format";
import { IS_MOCK } from "../../../lib/useSession";
import { merchantAdminApi } from "../../../lib/merchantAdminApi";

function DisputeSection({ taskId }: { taskId: string }) {
  const { data, isLoading } = useQuery({ queryKey: ["shopping-tasks", taskId, "orders"], queryFn: () => merchantAdminApi.taskOrders(taskId) });
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [openedIds, setOpenedIds] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openDispute = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: string; reason: string }) => merchantAdminApi.openDispute(taskId, orderId, reason),
    onSuccess: (res, { orderId }) => {
      setOpenedIds((o) => ({ ...o, [orderId]: res.disputeId }));
      setErrors((e) => ({ ...e, [orderId]: "" }));
    },
    onError: (err: Error, { orderId }) => setErrors((e) => ({ ...e, [orderId]: err.message })),
  });

  if (isLoading || !data?.orders.length) return null;

  return (
    <section className="card p-5">
      <h2 className="section-title mb-3">Disputes</h2>
      <ul className="flex flex-col gap-2">
        {data.orders.map((o) => (
          <li key={o.id} className="rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-xs text-muted">order {o.id.slice(0, 12)}… · {o.state}</span>
              <span className="font-mono text-xs">{usdc(Number(o.totalMicroUsdc))}</span>
            </div>
            {openedIds[o.id] ? (
              <p className="mt-2 text-sm text-success">Dispute opened — an operator will review it.</p>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  className="input flex-1"
                  placeholder="What went wrong?"
                  value={reasons[o.id] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [o.id]: e.target.value }))}
                />
                <button
                  className="btn"
                  disabled={!reasons[o.id]?.trim() || openDispute.isPending}
                  onClick={() => openDispute.mutate({ orderId: o.id, reason: reasons[o.id]! })}
                >
                  Open Dispute
                </button>
              </div>
            )}
            {errors[o.id] && <p className="mt-1 text-sm text-danger">{errors[o.id]}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ReceiptPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [spend, setSpend] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.task(taskId), api.spend(taskId)])
      .then(([t, s]) => {
        setSnapshot(t);
        setSpend(s);
      })
      .catch((err) => setError(err.message));
  }, [taskId]);

  if (error) return <p className="text-danger">Could not load receipt: {error}</p>;
  if (!snapshot) return <p className="text-muted">Loading…</p>;
  const receipt = snapshot.receipt;
  if (!receipt) return <p className="text-muted">This task has not settled yet (status: {snapshot.status}).</p>;

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-5">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Combined Receipt</h1>
            <p className="font-mono text-xs text-muted">{receipt.receiptId} · task {receipt.taskRef}</p>
          </div>
          <span className="badge badge-on">on-chain: {shortTx(receipt.receiptTx)}</span>
        </header>

        <dl className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-card-2 p-3">
            <dt className="section-title">Research Spend</dt>
            <dd className="mt-1 font-mono text-lg">{usdc(receipt.totalResearchMicroUsdc)}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card-2 p-3">
            <dt className="section-title">Main Payment</dt>
            <dd className="mt-1 font-mono text-lg text-brand">{usdc(receipt.totalMainMicroUsdc)}</dd>
          </div>
          <div className="rounded-lg border border-border bg-card-2 p-3">
            <dt className="section-title">Kalemler</dt>
            <dd className="mt-1 font-mono text-lg">
              {receipt.completedItems}/{receipt.totalItems}
            </dd>
          </div>
          <div className="rounded-lg border border-border bg-card-2 p-3">
            <dt className="section-title">Merchants</dt>
            <dd className="mt-1 font-mono text-lg">
              {receipt.completedShops}/{receipt.totalShops}
            </dd>
          </div>
        </dl>

        <h2 className="section-title mb-2 mt-5">Merchant Breakdown</h2>
        <ul className="flex flex-col gap-2">
          {receipt.shops.map((shop: any) => (
            <li key={shop.merchantSlug} className="rounded-lg border border-border bg-card-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{shop.merchantName}</span>
                  <span
                    className={`badge ${
                      shop.status === "completed" ? "badge-on" : shop.status === "dropped" ? "text-warning" : "text-danger"
                    }`}
                  >
                    {shop.status === "completed" ? "delivered" : shop.status === "dropped" ? "removed" : "refunded"}
                  </span>
                </div>
                <span className="font-mono">{usdc(shop.amountMicroUsdc)}</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {shop.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")}
                {shop.note && <> — {shop.note}</>}
              </p>
              {(shop.escrowTx || shop.releaseTx) && (
                <p className="mt-1 font-mono text-[11px] text-muted">
                  {shop.escrowTx && <>fund {shortTx(shop.escrowTx)}</>}
                  {shop.releaseTx && <> · release {shortTx(shop.releaseTx)}</>}
                </p>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 rounded-lg border border-border bg-card-2 p-3 text-xs">
          <p className="text-muted">
            metadata URI: <span className="font-mono">{receipt.metadataURI}</span>
          </p>
          <p className="mt-1 text-muted">
            metadata hash (keccak256): <span className="font-mono break-all">{receipt.metadataHash}</span>
          </p>
        </div>
      </section>

      {spend && (
        <section className="card p-5">
          <h2 className="section-title mb-3">Micropayment Breakdown (x402)</h2>
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                <th className="pb-2 font-medium">Endpoint</th>
                <th className="pb-2 font-medium">Merchant</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {spend.entries.map((entry: any) => (
                <tr key={entry.paymentId} className="border-t border-border">
                  <td className="py-1.5 font-mono">{entry.endpoint}</td>
                  <td className="py-1.5">{entry.merchant}</td>
                  <td className="py-1.5 font-mono">{entry.amountUsdc} USDC</td>
                  <td className={`py-1.5 ${entry.status === "refunded" ? "text-warning" : "text-success"}`}>
                    {entry.status === "refunded" ? "refunded" : "paid"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted">
            Total research: {usdc(spend.budget.spentMicroUsdc)} / {usdc(spend.budget.totalMicroUsdc)} budget
          </p>
        </section>
      )}

      {!IS_MOCK && <DisputeSection taskId={taskId} />}
    </div>
  );
}

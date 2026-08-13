"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { usdc, skuLabel, shortTx, STATE_LABELS } from "../../lib/format";

export default function MerchantConsolePage() {
  const [orders, setOrders] = useState<any[]>([]);
  const [merchants, setMerchants] = useState<any[]>([]);
  const [acceptances, setAcceptances] = useState<any[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [offline, setOffline] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [o, m] = await Promise.all([api.consoleOrders(), api.consoleMerchants()]);
        if (!alive) return;
        setOrders(o.orders);
        setMerchants(m.merchants);
        setOffline(false);
      } catch {
        if (alive) setOffline(true);
      }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Faz I §3 — merchant acceptance console: 3s poll + repeating notify sound
  // while anything is pending, muteable. {acceptances:[]} in mock mode, so
  // this section simply stays empty there.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    audioRef.current = new Audio("/notify.wav");
  }, []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { acceptances: rows } = await api.consoleAcceptances();
        if (alive) {
          // Avoid duplicate React identities if an older API process briefly
          // returns multiple join rows for the same acceptance during polling.
          setAcceptances(Array.from(new Map(rows.map((row: any) => [row.acceptanceId, row])).values()));
        }
      } catch {
        /* merchant service reachable check already handled by the orders poll above */
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (chimeTimerRef.current) {
      clearInterval(chimeTimerRef.current);
      chimeTimerRef.current = null;
    }
    if (acceptances.length === 0 || muted) return;
    const ring = () => void audioRef.current?.play().catch(() => {});
    ring();
    chimeTimerRef.current = setInterval(ring, 4000);
    return () => {
      if (chimeTimerRef.current) clearInterval(chimeTimerRef.current);
    };
  }, [acceptances.length, muted]);

  const respondAcceptance = async (a: any, action: "accept" | "reject") => {
    try {
      if (action === "accept") await api.acceptAcceptance(a.acceptanceId);
      else await api.rejectAcceptance(a.acceptanceId, "merchant rejected the order");
      setAcceptances((prev) => prev.filter((x) => x.acceptanceId !== a.acceptanceId));
    } catch (err) {
      setMessage(a.orderId, false, (err as Error).message);
    }
  };

  const setMessage = (orderId: string, ok: boolean, text: string) =>
    setMessages((prev) => ({ ...prev, [orderId]: { ok, text } }));

  const markReady = async (order: any) => {
    try {
      await api.markReady(order.merchantSlug, order.orderId);
      setMessage(order.orderId, true, "Marked as ready.");
    } catch (err) {
      setMessage(order.orderId, false, (err as Error).message);
    }
  };

  const verify = async (order: any) => {
    const code = codes[order.orderId]?.trim();
    if (!code) return setMessage(order.orderId, false, "Enter the pickup code.");
    try {
      const result = await api.verifyPickup(order.merchantSlug, order.orderId, code);
      setMessage(order.orderId, true, `Code verified — escrow released (${shortTx(result.txRef)}).`);
    } catch (err) {
      setMessage(order.orderId, false, `Code verification failed: ${(err as Error).message}`);
    }
  };

  const active = orders.filter((o) => !["completed", "refunded", "cancelled", "expired"].includes(o.state));
  const done = orders.filter((o) => ["completed", "refunded", "cancelled", "expired"].includes(o.state));

  return (
    <div className="flex flex-col gap-4">
      <section className="card p-4">
        <h1 className="text-xl font-bold">Merchant Console</h1>
        <p className="text-sm text-muted">
          Order board: enter the pickup code when the customer arrives to release escrow on-chain. An invalid code cannot move funds.
        </p>
        {offline && <p className="mt-2 text-xs text-danger">Merchant service is offline (:4000) — is `pnpm dev` running?</p>}
      </section>

      {acceptances.length > 0 && (
        <section className="card border-brand p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title">Pending Merchant Approvals ({acceptances.length})</h2>
            <button className="btn text-xs" onClick={() => setMuted((m) => !m)}>
              {muted ? "Unmute" : "Mute notifications"}
            </button>
          </div>
          <ul className="flex flex-col gap-2">
            {acceptances.map((a) => (
              <li key={a.acceptanceId} className="rounded-lg border border-brand bg-card-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.merchantName}</span>
                    <span className="font-mono text-sm">{usdc(a.totalMicroUsdc)}</span>
                  </div>
                  <span className="text-xs text-muted">
                    expires in: {Math.max(0, Math.floor(a.expiresAt - Date.now() / 1000))}s
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{a.items.map((i: any) => `${skuLabel(i.sku)} × ${i.qty}`).join(", ")}</p>
                <div className="mt-2 flex gap-2">
                  <button className="btn btn-primary" onClick={() => respondAcceptance(a, "accept")}>
                    Accept Order
                  </button>
                  <button className="btn" onClick={() => respondAcceptance(a, "reject")}>
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h2 className="section-title mb-3">Active Orders ({active.length})</h2>
        {active.length === 0 && <p className="text-sm text-muted">No active orders. Start a task from the shopping page.</p>}
        <ul className="flex flex-col gap-2">
          {active.map((order) => (
            <li key={order.orderId} className="rounded-lg border border-border bg-card-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{order.merchantName}</span>
                  <span className="badge">{STATE_LABELS[order.state] ?? order.state}</span>
                  <span className="font-mono text-sm">{usdc(order.totalMicroUsdc)}</span>
                </div>
                <span className="text-xs text-muted font-mono">{order.orderId.slice(0, 14)}…</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                {order.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")}
                {order.escrowTx && <> · escrow <span className="font-mono">{shortTx(order.escrowTx)}</span></>}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {order.state === "preparing" && (
                  <button className="btn" onClick={() => markReady(order)}>
                    ✅ Ready
                  </button>
                )}
                {(order.state === "ready" || order.state === "preparing") && (
                  <>
                    <input
                      className="input max-w-40"
                      inputMode="numeric"
                      placeholder="Pickup code"
                      value={codes[order.orderId] ?? ""}
                      onChange={(e) => setCodes((prev) => ({ ...prev, [order.orderId]: e.target.value }))}
                    />
                    <button className="btn btn-primary" onClick={() => verify(order)}>
                      Verify Code → Release Escrow
                    </button>
                  </>
                )}
              </div>
              {messages[order.orderId] && (
                <p className={`mt-1.5 text-xs ${messages[order.orderId]!.ok ? "text-success" : "text-danger"}`}>
                  {messages[order.orderId]!.text}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      {done.length > 0 && (
        <section className="card p-4">
          <h2 className="section-title mb-3">History ({done.length})</h2>
          <ul className="flex flex-col gap-1.5 text-sm">
            {done.map((order) => (
              <li key={order.orderId} className="flex items-center justify-between gap-2 text-muted">
                <span>
                  {order.merchantName} — {order.items.map((i: any) => skuLabel(i.sku)).join(", ")}
                </span>
                <span className={`badge ${order.state === "completed" ? "badge-on" : "text-danger"}`}>
                  {STATE_LABELS[order.state] ?? order.state}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {false && <section className="card p-4">
        <h2 className="section-title mb-3">Inventory Status</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {merchants.map((m) => (
            <div key={m.slug} className="rounded-lg border border-border bg-card-2 p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs text-muted">★ {m.qualityScore}/10</span>
              </div>
              <ul className="mt-1 text-xs text-muted">
                {m.inventory.map((item: any) => (
                  <li key={item.sku} className="flex justify-between">
                    <span>{skuLabel(item.sku)}</span>
                    <span className="font-mono">
                      {usdc(item.priceMicroUsdc)} · stock {item.stockQty}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>}
    </div>
  );
}

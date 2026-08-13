"use client";

import { usdc, skuLabel } from "../lib/format";

export interface TimelineEvent {
  seq: number;
  type: string;
  ts: number;
  data: any;
}

function describe(e: TimelineEvent): { icon: string; text: string; tone?: "success" | "danger" | "warning" } | null {
  const d = e.data;
  switch (e.type) {
    case "task_created":
      return { icon: "🛒", text: `Task created — budget ${usdc(d.budgetMicroUsdc)}` };
    case "plan_started":
      return { icon: "🧠", text: `Building plan (${d.provider})…` };
    case "plan_ready":
      return {
        icon: "🧠",
        text: `List ready: ${d.plan.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}${i.essential ? "★" : ""}`).join(", ")}`,
        tone: "success",
      };
    case "discovery_complete":
      return { icon: "📍", text: `${d.count} merchants found (sorted by distance)` };
    case "paid_request":
      return {
        icon: "💸",
        text: `${d.endpoint} @ ${d.merchantName} — ${usdc(d.amountMicroUsdc)}${d.feeRefunded ? " (fee refunded)" : ""} · ${d.reason}`,
        tone: d.ok ? undefined : "danger",
      };
    case "quote_received":
      return {
        icon: "🧾",
        text: `${d.merchantName}: ${usdc(d.totalMicroUsdc)} quote (nonce ${d.nonce}) — signature ${d.signatureVerified ? "verified ✓" : "INVALID ✗"}`,
        tone: d.signatureVerified ? undefined : "danger",
      };
    case "quote_unavailable":
      return { icon: "🚫", text: `${d.merchant}: could not provide a quote (${d.error})`, tone: "warning" };
    case "quality_scored":
      return {
        icon: "⭐",
        text: `Kalite oracle (${skuLabel(d.sku)}): ${d.merchants.map((m: any) => `${m.merchantName} ${m.qualityScore}/10`).join(" vs ")}`,
      };
    case "reservation_made":
      return { icon: "🔒", text: `${d.merchantName}: ${skuLabel(d.sku)}×${d.qty} rezerve (TTL ${d.ttlSeconds}s)`, tone: "success" };
    case "negotiation_success":
      return { icon: "🤝", text: `${d.merchantName}: negotiation succeeded — ${usdc(d.discountMicroUsdc)} discount, new total ${usdc(d.newTotalMicroUsdc)}`, tone: "success" };
    case "negotiation_declined":
      return { icon: "🤝", text: `${d.merchant}: negotiation declined (${d.reason})${d.feeRefunded ? " — fee automatically refunded" : ""}`, tone: "warning" };
    case "negotiation_skipped":
      return { icon: "🤝", text: `${d.merchant}: negotiation skipped — ${d.reason}`, tone: "warning" };
    case "budget_blocked":
      return { icon: "⛔", text: `Budget blocked (${d.kind}): ${d.detail}`, tone: "danger" };
    case "options_ready":
      return { icon: "📊", text: `Options ready — research spend ${usdc(d.budget.spentMicroUsdc)}`, tone: "success" };
    case "option_selected":
      return { icon: "👤", text: `Selected: ${d.option.label} (${usdc(d.option.totalMicroUsdc)})` };
    case "approval_received":
      return { icon: "✅", text: `Payment approved — escrow funding begins (${usdc(d.totalMicroUsdc)})`, tone: "success" };
    case "escrow_funded":
      return { icon: "🏦", text: `${d.merchantName}: escrow funded ${usdc(d.amountMicroUsdc)} — pickup code ${d.pickupCode}`, tone: "success" };
    case "funding_failed":
      return { icon: "❌", text: `${d.merchantName ?? d.merchant}: funding failed — ${d.error}`, tone: "danger" };
    case "saga_alternative":
      return { icon: "🔁", text: `Saga: ${d.failedMerchant} yerine ${d.alternativeMerchant} deneniyor` };
    case "shop_dropped":
      return { icon: "🪂", text: `Saga: ${d.merchantName} removed — ${d.reason}`, tone: "warning" };
    case "saga_cancel":
      return { icon: "🛑", text: `Saga: essential item could not be funded (${d.merchant}) — cancelled and refunded`, tone: "danger" };
    case "order_update":
      return { icon: "📦", text: `${d.merchantName ?? d.merchant}: ${d.state}${d.note ? ` — ${d.note}` : ""}` };
    case "escrow_refunded":
      return { icon: "↩️", text: `${d.merchant}: escrow refunded (${d.reason})`, tone: "warning" };
    case "receipt_ready":
      return { icon: "🧾", text: `Combined receipt ready — ${d.receipt.receiptTx}`, tone: "success" };
    case "task_failed":
      return { icon: "💥", text: `Task failed: ${d.error}`, tone: "danger" };
    case "task_cancelled":
      return { icon: "🛑", text: `Task cancelled: ${d.reason}`, tone: "danger" };
    case "feedback_posted":
      return { icon: "🌟", text: `Feedback recorded: ${d.merchant} ${d.score}/5`, tone: "success" };
    case "items_unfulfillable":
      return { icon: "🚫", text: `Unavailable items: ${d.skus.map(skuLabel).join(", ")}`, tone: "warning" };
    default:
      return null;
  }
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Live Timeline (SSE)</h2>
      <ol className="flex max-h-80 flex-col gap-1.5 overflow-y-auto pr-1 text-[13px]" aria-live="polite">
        {events.map((e) => {
          const line = describe(e);
          if (!line) return null;
          const tone =
            line.tone === "success" ? "text-success" : line.tone === "danger" ? "text-danger" : line.tone === "warning" ? "text-warning" : "text-ink";
          return (
            <li key={e.seq} className="flex items-start gap-2">
              <span aria-hidden>{line.icon}</span>
              <span className={tone}>{line.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

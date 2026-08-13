"use client";

import { useEffect, useState } from "react";
import { usdc, skuLabel } from "../lib/format";
import type { TimelineEvent } from "./Timeline";

interface QuoteInfo {
  merchant: string;
  merchantName: string;
  quoteId: string;
  totalMicroUsdc: number;
  items: { sku: string; qty: number; unitPriceMicroUsdc: number }[];
  validUntil: number;
  nonce: number;
  signatureVerified: boolean;
  superseded?: boolean;
}

/** Latest quote per merchant, derived from the SSE timeline. */
export function quotesFromEvents(events: TimelineEvent[]): QuoteInfo[] {
  const byMerchant = new Map<string, QuoteInfo>();
  for (const e of events) {
    if (e.type === "quote_received") {
      byMerchant.set(e.data.merchant, { ...(e.data as QuoteInfo) });
    }
    if (e.type === "negotiation_success") {
      const q = byMerchant.get(e.data.merchant);
      if (q) {
        byMerchant.set(e.data.merchant, {
          ...q,
          quoteId: e.data.newQuoteId,
          totalMicroUsdc: e.data.newTotalMicroUsdc,
          nonce: q.nonce + 1,
        });
      }
    }
  }
  return [...byMerchant.values()];
}

function Countdown({ validUntil }: { validUntil: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const left = validUntil - now;
  if (left <= 0) return <span className="badge badge-off">expired</span>;
  return (
    <span className={`badge ${left < 60 ? "text-warning" : ""}`}>
      TTL {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}

export function QuoteBoard({ events }: { events: TimelineEvent[] }) {
  const quotes = quotesFromEvents(events);
  if (quotes.length === 0) return null;
  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Signed Quotes (Ed25519)</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {quotes.map((q) => (
          <div key={q.quoteId} className="rounded-lg border border-border bg-card-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{q.merchantName}</span>
              <Countdown validUntil={q.validUntil} />
            </div>
            <ul className="mt-1.5 text-xs text-muted">
              {q.items.map((i) => (
                <li key={i.sku}>
                  {skuLabel(i.sku)} × {i.qty} @ {usdc(i.unitPriceMicroUsdc)}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-sm">{usdc(q.totalMicroUsdc)}</span>
              <span className={`badge ${q.signatureVerified ? "badge-on" : "badge-off"}`}>
                {q.signatureVerified ? "signature verified ✓" : "invalid signature ✗"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

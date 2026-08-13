"use client";

const CATEGORY_LABELS: Record<string, string> = {
  butcher: "Butcher",
  greengrocer: "Greengrocer",
  bakery: "Bakery",
  market: "Market",
};

export function MerchantList({ merchants }: { merchants: any[] }) {
  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Discovered Merchant Agents</h2>
      <ul className="flex flex-col gap-2">
        {merchants.map((m) => (
          <li key={m.slug} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card-2 px-3 py-2">
            <div className="flex items-center gap-3">
              <span className="font-semibold">{m.name}</span>
              <span className="badge">{CATEGORY_LABELS[m.category] ?? m.category}</span>
              <span className="text-xs text-muted">{m.distanceM} m</span>
              <span className="text-xs text-warning">★ {m.qualityScore}/10</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`badge ${m.verification.identity ? "badge-on" : "badge-off"}`} title="ERC-8004 kimlik">
                kimlik
              </span>
              <span className={`badge ${m.verification.attestation ? "badge-on" : "badge-off"}`} title="EAS attestation">
                attestation
              </span>
              <span className={`badge ${m.verification.stake ? "badge-on" : "badge-off"}`} title="Stake">
                stake
              </span>
              {m.negotiation && <span className="badge">negotiation ✓</span>}
              {m.reservation && <span className="badge">reservation ✓</span>}
              {m.pickup && <span className="badge">gel-al ✓</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

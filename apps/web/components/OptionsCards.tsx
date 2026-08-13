"use client";

import { usdc, skuLabel } from "../lib/format";

const KIND_META: Record<string, { title: string; icon: string }> = {
  cheapest: { title: "Lowest Price", icon: "💰" },
  best_quality: { title: "Best Quality", icon: "⭐" },
  pickup_optimized: { title: "Optimized Pickup Route", icon: "🚶" },
};

export function OptionsCards({
  options,
  selected,
  canSelect,
  onSelect,
}: {
  options: any[];
  selected: string | null;
  canSelect: boolean;
  onSelect: (kind: string) => void;
}) {
  return (
    <section className="card p-4">
      <h2 className="section-title mb-3">Shopping Options</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {options.map((option) => {
          const meta = KIND_META[option.kind] ?? { title: option.kind, icon: "🛍" };
          const isSelected = selected === option.kind;
          return (
            <article
              key={option.kind}
              className={`flex flex-col gap-2 rounded-lg border p-3 transition ${
                isSelected ? "border-brand bg-card-2" : "border-border bg-card-2/60"
              }`}
            >
              <header className="flex items-center justify-between">
                <span className="font-semibold">
                  {meta.icon} {meta.title}
                </span>
                <span className="font-mono text-sm text-brand">{usdc(option.totalMicroUsdc)}</span>
              </header>
              <p className="text-xs text-muted">
                {option.stops} stops · ~{option.totalWalkM} m · quality {option.avgQuality}/10
              </p>
              <ul className="flex flex-col gap-1 text-xs">
                {option.shops.map((shop: any) => (
                  <li key={shop.merchantSlug} className="rounded border border-border px-2 py-1">
                    <span className="font-medium">{shop.merchantName}</span>{" "}
                    <span className="text-muted">
                      ({shop.distanceM} m) — {shop.items.map((i: any) => `${skuLabel(i.sku)}×${i.qty}`).join(", ")} ={" "}
                      {usdc(shop.subtotalMicroUsdc)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted">{option.note}</p>
              {canSelect && (
                <button className={isSelected ? "btn btn-primary" : "btn"} onClick={() => onSelect(option.kind)}>
                  {isSelected ? "Selected" : "Select"}
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

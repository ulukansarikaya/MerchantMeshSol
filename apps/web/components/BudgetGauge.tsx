"use client";

import { usdc } from "../lib/format";

export function BudgetGauge({ budget }: { budget: { totalMicroUsdc: number; spentMicroUsdc: number; remainingMicroUsdc: number } }) {
  const pct = Math.min(100, Math.round((budget.spentMicroUsdc / budget.totalMicroUsdc) * 100));
  return (
    <div className="card flex flex-col gap-1 px-3 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="section-title">Research Budget</span>
        <span className="font-mono text-muted">
          {usdc(budget.spentMicroUsdc)} / {usdc(budget.totalMicroUsdc)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
        <div
          className={`h-full rounded-full ${pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warning" : "bg-success"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

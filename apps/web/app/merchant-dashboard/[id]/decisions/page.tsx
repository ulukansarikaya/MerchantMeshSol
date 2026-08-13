"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../../lib/merchantAdminApi";

function usdc(micro: string): string {
  return `${(Number(micro) / 1_000_000).toFixed(2)} USDC`;
}

export default function MerchantDecisionsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "decisions"], queryFn: () => merchantAdminApi.decisions(id) });

  return (
    <div className="card p-4">
      <h2 className="section-title mb-1">Pricing Decisions</h2>
      <p className="text-xs text-muted mb-3">
        Each row shows the LLM proposal at quote time and how the deterministic policy engine constrained it.
      </p>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.decisions.length ? (
        <p className="text-sm text-muted">No pricing decisions have been recorded yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.decisions.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">{new Date(d.createdAt).toLocaleString("tr-TR")}</span>
                {d.fallbackUsed ? (
                  <span className="badge badge-off">yedek yol: {d.fallbackReason}</span>
                ) : (
                  <span className="badge badge-on">{d.model}</span>
                )}
              </div>
              <div className="flex gap-4 text-xs text-muted">
                <span>Taban: {usdc(d.baseTotalMicroUsdc)}</span>
                <span>Discount: {usdc(d.discountMicroUsdc)}</span>
                <span>Nihai: {usdc(d.finalTotalMicroUsdc)}</span>
              </div>
              {d.llmOutputJson?.rationale && <p className="mt-2 text-xs italic text-muted">"{d.llmOutputJson.rationale}"</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../lib/merchantAdminApi";

const STRATEGIES = ["balanced", "aggressive", "conservative"] as const;
const STRATEGY_LABELS: Record<string, string> = { balanced: "Balanced", aggressive: "Aggressive", conservative: "Conservative" };

export default function MerchantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id], queryFn: () => merchantAdminApi.get(id) });
  const [publishError, setPublishError] = useState<string | null>(null);

  const publish = useMutation({
    mutationFn: () => merchantAdminApi.publish(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id] }),
    onError: (err: Error) => setPublishError(err.message),
  });

  const updateStrategy = useMutation({
    mutationFn: (agentStrategy: string) => merchantAdminApi.update(id, { agentStrategy }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id] }),
  });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (!data) return <p className="text-sm text-danger">Merchant not found.</p>;
  const m = data.merchant;

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="section-title">{m.name}</h2>
          <span className={`badge ${m.status === "active" ? "badge-on" : "badge-off"}`}>{m.status}</span>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-muted">Slug</dt>
          <dd>{m.slug}</dd>
          <dt className="text-muted">Kategori</dt>
          <dd>{m.category}</dd>
          <dt className="text-muted">Runtime</dt>
          <dd>{m.runtime}</dd>
          <dt className="text-muted">On-chain merchant ID</dt>
          <dd>{m.onChainMerchantId ?? "— not published yet —"}</dd>
          <dt className="text-muted">Pricing policy version</dt>
          <dd>{m.pricingPolicyVersion}</dd>
        </dl>

        {m.onChainMerchantId === null && (
          <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
            <p className="text-xs text-muted">
              Publishing creates on-chain records in merchant_directory and order_escrow. Only authorized operator accounts can execute it.
              If you are not an operator, wait for your business review to complete.
            </p>
            <button className="btn btn-primary self-start" onClick={() => publish.mutate()} disabled={publish.isPending}>
              {publish.isPending ? "Publishing…" : "Publish On-chain"}
            </button>
            {publishError && <p className="text-sm text-danger">{publishError}</p>}
          </div>
        )}
      </div>

      <div className="card p-4">
        <h3 className="section-title mb-3">Agent stratejisi</h3>
        <div className="flex gap-2">
          {STRATEGIES.map((s) => (
            <button
              key={s}
              className={`btn ${m.agentStrategy === s ? "btn-primary" : ""}`}
              onClick={() => updateStrategy.mutate(s)}
              disabled={updateStrategy.isPending}
            >
              {STRATEGY_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <nav className="flex gap-3 text-sm">
        <Link className="btn" href={`/merchant-dashboard/${id}/products`}>Products</Link>
        <Link className="btn" href={`/merchant-dashboard/${id}/inventory`}>Inventory</Link>
        <Link className="btn" href={`/merchant-dashboard/${id}/pricing`}>Pricing Policies</Link>
        <Link className="btn" href={`/merchant-dashboard/${id}/decisions`}>Pricing Decisions</Link>
        <Link className="btn" href={`/merchant-dashboard/${id}/campaigns`}>Campaigns</Link>
        <Link className="btn" href={`/merchant-dashboard/${id}/disputes`}>Disputes</Link>
      </nav>
    </div>
  );
}

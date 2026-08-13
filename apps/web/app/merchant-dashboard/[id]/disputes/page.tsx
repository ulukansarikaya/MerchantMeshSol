"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../../lib/merchantAdminApi";

export default function MerchantDisputesPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "disputes"], queryFn: () => merchantAdminApi.merchantDisputes(id) });

  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">Disputes</h2>
      <p className="mb-3 text-xs text-muted">Read-only — an operator reviews and resolves disputes from the admin panel.</p>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.disputes.length ? (
        <p className="text-sm text-muted">No disputes against this merchant.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.disputes.map((d) => (
            <li key={d.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted">task {d.taskId}</span>
                <span className={`badge ${d.status === "open" ? "text-danger" : d.status === "closed" ? "badge-off" : "badge-on"}`}>
                  {d.status}
                </span>
              </div>
              <p className="mt-2 text-sm">{d.reason}</p>
              {d.resolution && <p className="mt-1 text-xs text-muted">Resolution: {d.resolution}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

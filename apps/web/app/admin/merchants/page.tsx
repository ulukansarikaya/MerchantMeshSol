"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../lib/merchantAdminApi";

export default function AdminMerchantsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "merchants"], queryFn: () => merchantAdminApi.adminMerchants() });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "merchants"] });
  const suspend = useMutation({ mutationFn: (id: string) => merchantAdminApi.suspend(id), onSuccess: invalidate });
  const activate = useMutation({ mutationFn: (id: string) => merchantAdminApi.activate(id), onSuccess: invalidate });

  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">All Merchants</h2>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.merchants.length ? (
        <p className="text-sm text-muted">No merchants yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="pb-2 font-medium">Name</th>
              <th className="pb-2 font-medium">Slug</th>
              <th className="pb-2 font-medium">Category</th>
              <th className="pb-2 font-medium">Status</th>
              <th className="pb-2 font-medium">On-chain ID</th>
              <th className="pb-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.merchants.map((m) => (
              <tr key={m.id} className="border-t border-border">
                <td className="py-2">{m.name}</td>
                <td className="py-2 font-mono text-xs">{m.slug}</td>
                <td className="py-2">{m.category}</td>
                <td className="py-2">
                  <span className={`badge ${m.status === "active" ? "badge-on" : "badge-off"}`}>{m.status}</span>
                </td>
                <td className="py-2 font-mono text-xs">{m.onChainMerchantId ?? "—"}</td>
                <td className="py-2">
                  {m.status === "suspended" ? (
                    <button className="btn" disabled={activate.isPending} onClick={() => activate.mutate(m.id)}>
                      Activate
                    </button>
                  ) : (
                    <button className="btn" disabled={suspend.isPending} onClick={() => suspend.mutate(m.id)}>
                      Suspend
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

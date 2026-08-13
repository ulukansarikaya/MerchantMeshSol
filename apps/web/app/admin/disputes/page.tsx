"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../lib/merchantAdminApi";

export default function AdminDisputesPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["admin", "disputes"], queryFn: () => merchantAdminApi.adminDisputes() });
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin", "disputes"] });
  const review = useMutation({ mutationFn: (id: string) => merchantAdminApi.reviewDispute(id), onSuccess: invalidate });
  const close = useMutation({ mutationFn: (id: string) => merchantAdminApi.closeDispute(id), onSuccess: invalidate });
  const resolve = useMutation({
    mutationFn: ({ id, outcome }: { id: string; outcome: "refund" | "release" }) =>
      merchantAdminApi.resolveDispute(id, outcome, resolutionNotes[id]),
    onSuccess: (_, { id }) => {
      setErrors((e) => ({ ...e, [id]: "" }));
      invalidate();
    },
    onError: (err: Error, { id }) => setErrors((e) => ({ ...e, [id]: err.message })),
  });

  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">Disputes</h2>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !data?.disputes.length ? (
        <p className="text-sm text-muted">No disputes.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {data.disputes.map(({ dispute, taskOrder }) => (
            <li key={dispute.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted">
                  order {taskOrder.id.slice(0, 12)}… · task {taskOrder.taskId}
                </span>
                <span className={`badge ${dispute.status === "open" ? "text-danger" : dispute.status === "closed" ? "badge-off" : "badge-on"}`}>
                  {dispute.status}
                </span>
              </div>
              <p className="mt-2 text-sm">{dispute.reason}</p>
              {dispute.resolution && <p className="mt-1 text-xs text-muted">Resolution: {dispute.resolution}</p>}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {dispute.status === "open" && (
                  <button className="btn" disabled={review.isPending} onClick={() => review.mutate(dispute.id)}>
                    Start Review
                  </button>
                )}
                {dispute.status === "reviewing" && (
                  <>
                    <input
                      className="input w-56"
                      placeholder="resolution note (optional)"
                      value={resolutionNotes[dispute.id] ?? ""}
                      onChange={(e) => setResolutionNotes((n) => ({ ...n, [dispute.id]: e.target.value }))}
                    />
                    <button
                      className="btn btn-primary"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ id: dispute.id, outcome: "refund" })}
                    >
                      Refund Buyer
                    </button>
                    <button
                      className="btn"
                      disabled={resolve.isPending}
                      onClick={() => resolve.mutate({ id: dispute.id, outcome: "release" })}
                    >
                      Release to Merchant
                    </button>
                  </>
                )}
                {dispute.status !== "closed" && (
                  <button className="btn" disabled={close.isPending} onClick={() => close.mutate(dispute.id)}>
                    Close
                  </button>
                )}
              </div>
              {errors[dispute.id] && <p className="mt-2 text-sm text-danger">{errors[dispute.id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

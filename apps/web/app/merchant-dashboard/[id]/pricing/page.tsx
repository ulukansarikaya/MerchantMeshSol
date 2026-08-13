"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../../lib/merchantAdminApi";

export default function MerchantPricingPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "pricing-policies"], queryFn: () => merchantAdminApi.pricingPolicies(id) });
  const [merchantForm, setMerchantForm] = useState({ negotiationEnabled: false, maxDiscountBps: "0" });

  const updateMerchant = useMutation({
    mutationFn: () => merchantAdminApi.update(id, { negotiationEnabled: merchantForm.negotiationEnabled, maxDiscountBps: Number(merchantForm.maxDiscountBps) }),
  });

  const updateSku = useMutation({
    mutationFn: (vars: { sku: string; maxDiscountBps?: number; lowStockBehavior?: string }) =>
      merchantAdminApi.updatePricingPolicy(id, vars.sku, { maxDiscountBps: vars.maxDiscountBps, lowStockBehavior: vars.lowStockBehavior }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id, "pricing-policies"] }),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4">
        <h2 className="section-title mb-3">Merchant-wide Negotiation Settings</h2>
        <p className="text-xs text-muted mb-3">
          When negotiation is enabled, the LLM proposes a discount for each quote. The final discount is deterministically
          capped by the maximum basis points configured here and each product's minimum price.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={merchantForm.negotiationEnabled} onChange={(e) => setMerchantForm({ ...merchantForm, negotiationEnabled: e.target.checked })} />
            Negotiation Enabled
          </label>
          <input className="input w-32" placeholder="Maks. bps" value={merchantForm.maxDiscountBps} onChange={(e) => setMerchantForm({ ...merchantForm, maxDiscountBps: e.target.value })} />
          <button className="btn btn-primary" onClick={() => updateMerchant.mutate()} disabled={updateMerchant.isPending}>Save</button>
        </div>
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Product-level Policies</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="pb-2">SKU</th>
                <th className="pb-2">Maks. indirim (bps)</th>
                <th className="pb-2">Low-stock Behavior</th>
              </tr>
            </thead>
            <tbody>
              {data?.perSku.map((p) => (
                <tr key={p.sku} className="border-t border-border">
                  <td className="py-2">{p.sku}</td>
                  <td className="py-2">
                    <input
                      className="input w-24"
                      defaultValue={p.maxDiscountBps ?? ""}
                      placeholder="inherit"
                      onBlur={(e) => updateSku.mutate({ sku: p.sku, maxDiscountBps: e.target.value ? Number(e.target.value) : undefined })}
                    />
                  </td>
                  <td className="py-2">
                    <select
                      className="input"
                      defaultValue={p.lowStockBehavior}
                      onChange={(e) => updateSku.mutate({ sku: p.sku, lowStockBehavior: e.target.value })}
                    >
                      <option value="hold">Hold</option>
                      <option value="block">Block</option>
                      <option value="discount_off">Disable discount</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

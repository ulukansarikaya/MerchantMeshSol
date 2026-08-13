"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CANONICAL_SKUS } from "@merchantmesh/shared";
import { merchantAdminApi } from "../../../../lib/merchantAdminApi";

export default function MerchantProductsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "products"], queryFn: () => merchantAdminApi.products(id) });
  const [form, setForm] = useState({ canonicalSku: CANONICAL_SKUS[0]?.sku ?? "", merchantProductName: "", basePriceMicroUsdc: "", minimumPriceMicroUsdc: "", initialStock: "0" });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id, "products"] });

  const create = useMutation({
    mutationFn: () =>
      merchantAdminApi.createProduct(id, {
        canonicalSku: form.canonicalSku,
        merchantProductName: form.merchantProductName || form.canonicalSku,
        unitType: "piece",
        basePriceMicroUsdc: form.basePriceMicroUsdc,
        minimumPriceMicroUsdc: form.minimumPriceMicroUsdc,
        initialStock: Number(form.initialStock),
      }),
    onSuccess: () => {
      setForm({ canonicalSku: CANONICAL_SKUS[0]?.sku ?? "", merchantProductName: "", basePriceMicroUsdc: "", minimumPriceMicroUsdc: "", initialStock: "0" });
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const deactivate = useMutation({
    mutationFn: (productId: string) => merchantAdminApi.deleteProduct(id, productId),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4">
        <h2 className="section-title mb-3">Products</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="pb-2">SKU</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Base Price</th>
                <th className="pb-2">Minimum Price</th>
                <th className="pb-2">Status</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {data?.products.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="py-2">{p.canonicalSku}</td>
                  <td className="py-2">{p.merchantProductName}</td>
                  <td className="py-2">{Number(p.basePriceMicroUsdc) / 1_000_000} USDC</td>
                  <td className="py-2">{Number(p.minimumPriceMicroUsdc) / 1_000_000} USDC</td>
                  <td className="py-2"><span className={`badge ${p.active ? "badge-on" : "badge-off"}`}>{p.active ? "active" : "inactive"}</span></td>
                  <td className="py-2 text-right">
                    {p.active && (
                      <button className="btn btn-danger" onClick={() => deactivate.mutate(p.id)} disabled={deactivate.isPending}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Add Product</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <select className="input" value={form.canonicalSku} onChange={(e) => setForm({ ...form, canonicalSku: e.target.value })}>
            {CANONICAL_SKUS.map((s) => (
              <option key={s.sku} value={s.sku}>{s.nameEn} ({s.sku})</option>
            ))}
          </select>
          <input className="input" placeholder="Merchant-specific product name (optional)" value={form.merchantProductName} onChange={(e) => setForm({ ...form, merchantProductName: e.target.value })} />
          <div className="flex gap-3">
            <input className="input" placeholder="Base price (micro-USDC)" value={form.basePriceMicroUsdc} onChange={(e) => setForm({ ...form, basePriceMicroUsdc: e.target.value })} required />
            <input className="input" placeholder="Minimum price (micro-USDC)" value={form.minimumPriceMicroUsdc} onChange={(e) => setForm({ ...form, minimumPriceMicroUsdc: e.target.value })} required />
          </div>
          <input className="input" placeholder="Initial stock quantity" value={form.initialStock} onChange={(e) => setForm({ ...form, initialStock: e.target.value })} required />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending ? "Adding…" : "Add Product"}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../../../lib/merchantAdminApi";

export default function MerchantInventoryPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "inventory"], queryFn: () => merchantAdminApi.inventory(id) });
  const [deltas, setDeltas] = useState<Record<string, string>>({});

  const adjust = useMutation({
    mutationFn: (merchantProductId: string) =>
      merchantAdminApi.adjustInventory(id, {
        merchantProductId,
        delta: Number(deltas[merchantProductId] ?? "0"),
        movementType: "manual_adjustment",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id, "inventory"] }),
  });

  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">Inventory</h2>
      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="pb-2">SKU</th>
              <th className="pb-2">Ad</th>
              <th className="pb-2">Fiziksel</th>
              <th className="pb-2">Rezerve</th>
              <th className="pb-2">Available</th>
              <th className="pb-2">Adjustment</th>
            </tr>
          </thead>
          <tbody>
            {data?.inventory.map((row) => (
              <tr key={row.merchantProductId} className="border-t border-border">
                <td className="py-2">{row.sku}</td>
                <td className="py-2">{row.name}</td>
                <td className="py-2">{row.physicalQuantity}</td>
                <td className="py-2">{row.reservedQuantity}</td>
                <td className="py-2">{row.availableQuantity}{row.availableQuantity <= row.lowStockThreshold && <span className="badge badge-off ml-2">low stock</span>}</td>
                <td className="py-2">
                  <div className="flex gap-2">
                    <input
                      className="input w-20"
                      placeholder="±adet"
                      value={deltas[row.merchantProductId] ?? ""}
                      onChange={(e) => setDeltas({ ...deltas, [row.merchantProductId]: e.target.value })}
                    />
                    <button className="btn" onClick={() => adjust.mutate(row.merchantProductId)} disabled={adjust.isPending}>
                      Uygula
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

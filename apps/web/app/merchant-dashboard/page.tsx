"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi } from "../../lib/merchantAdminApi";

const CATEGORIES = ["butcher", "greengrocer", "bakery", "market"] as const;
const CATEGORY_LABELS: Record<string, string> = { butcher: "Butcher", greengrocer: "Greengrocer", bakery: "Bakery", market: "Market" };
const STATUS_LABELS: Record<string, string> = { draft: "Draft", pending_review: "Pending Review", active: "Active", suspended: "Suspended", archived: "Archived" };

export default function MerchantDashboardHome() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", "mine"], queryFn: () => merchantAdminApi.mine() });
  const [form, setForm] = useState({ slug: "", name: "", category: "butcher" as string, lat: "39.9208", lng: "32.8541" });
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      merchantAdminApi.create({ slug: form.slug, name: form.name, category: form.category, lat: Number(form.lat), lng: Number(form.lng) }),
    onSuccess: () => {
      setForm({ slug: "", name: "", category: "butcher", lat: "39.9208", lng: "32.8541" });
      queryClient.invalidateQueries({ queryKey: ["merchant-agents", "mine"] });
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4">
        <h2 className="section-title mb-3">My Merchant Agents</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : data?.merchants.length ? (
          <ul className="flex flex-col gap-2">
            {data.merchants.map((m) => (
              <li key={m.id}>
                <Link href={`/merchant-dashboard/${m.id}`} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-card-2">
                  <span className="flex flex-col">
                    <span className="font-medium">{m.name}</span>
                    <span className="text-xs text-muted">{m.slug} · {CATEGORY_LABELS[m.category] ?? m.category} · {m.role}</span>
                  </span>
                  <span className={`badge ${m.status === "active" ? "badge-on" : "badge-off"}`}>{STATUS_LABELS[m.status] ?? m.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">You do not have a merchant agent yet — create one below.</p>
        )}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Create a Merchant Agent</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <input className="input" placeholder="slug (e.g. alice-greengrocer)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} required />
          <input className="input" placeholder="Business name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select className="input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <div className="flex gap-3">
            <input className="input" placeholder="Latitude" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} required />
            <input className="input" placeholder="Longitude" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} required />
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create as Draft"}
          </button>
        </form>
      </div>
    </div>
  );
}

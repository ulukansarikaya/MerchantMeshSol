"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { merchantAdminApi, CAMPAIGN_RULE_TYPES } from "../../../../lib/merchantAdminApi";

const RULE_LABELS: Record<string, string> = { percent_off: "Percent off", fixed_off: "Fixed amount off" };
const STATUS_OPTIONS = ["draft", "active", "paused", "expired"] as const;

export default function MerchantCampaignsPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["merchant-agents", id, "campaigns"], queryFn: () => merchantAdminApi.campaigns(id) });
  const [form, setForm] = useState({
    name: "",
    ruleType: "percent_off" as (typeof CAMPAIGN_RULE_TYPES)[number],
    discountValue: "",
    maximumDiscountMicroUsdc: "",
    stackPolicy: "exclusive" as "exclusive" | "stackable",
  });
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["merchant-agents", id, "campaigns"] });

  const create = useMutation({
    mutationFn: () =>
      merchantAdminApi.createCampaign(id, {
        name: form.name,
        stackPolicy: form.stackPolicy,
        rule: {
          ruleType: form.ruleType,
          discountType: form.ruleType === "percent_off" ? "percent" : "fixed",
          discountValue: form.discountValue,
          maximumDiscountMicroUsdc: form.maximumDiscountMicroUsdc || undefined,
        },
      }),
    onSuccess: () => {
      setForm({ name: "", ruleType: "percent_off", discountValue: "", maximumDiscountMicroUsdc: "", stackPolicy: "exclusive" });
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });

  const setStatus = useMutation({
    mutationFn: (vars: { campaignId: string; status: string }) => merchantAdminApi.updateCampaign(id, vars.campaignId, { status: vars.status }),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="card p-4">
        <h2 className="section-title mb-3">Campaigns</h2>
        <p className="mb-3 text-xs text-muted">
          Only <strong>percent off</strong> and <strong>fixed amount off</strong> campaigns are evaluated at quote time today.
          Other rule types in the schema (bogo, bundle, min basket, time window, loyalty, first order) are reserved for a
          future pass. A discount always respects each product&apos;s minimum price, regardless of the campaign.
        </p>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : !data?.campaigns.length ? (
          <p className="text-sm text-muted">No campaigns yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.campaigns.map((c) => (
              <li key={c.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className={`badge ${c.status === "active" ? "badge-on" : "badge-off"}`}>{c.status}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {c.rules.map((r) => `${RULE_LABELS[r.ruleType] ?? r.ruleType}: ${r.discountValue}${r.discountType === "percent" ? " bps" : " micro-USDC"}`).join(", ")}
                  {" · "}
                  {c.stackPolicy}
                </p>
                <div className="mt-2 flex gap-2">
                  {STATUS_OPTIONS.filter((s) => s !== c.status).map((s) => (
                    <button key={s} className="btn" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ campaignId: c.id, status: s })}>
                      Set {s}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-4">
        <h2 className="section-title mb-3">Create Campaign</h2>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <input className="input" placeholder="Campaign name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <div className="flex gap-3">
            <select className="input" value={form.ruleType} onChange={(e) => setForm({ ...form, ruleType: e.target.value as (typeof CAMPAIGN_RULE_TYPES)[number] })}>
              {CAMPAIGN_RULE_TYPES.map((t) => (
                <option key={t} value={t}>{RULE_LABELS[t]}</option>
              ))}
            </select>
            <input
              className="input"
              placeholder={form.ruleType === "percent_off" ? "bps (e.g. 1000 = 10%)" : "micro-USDC off"}
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: e.target.value })}
              required
            />
          </div>
          <input
            className="input"
            placeholder="Max discount cap (micro-USDC, optional)"
            value={form.maximumDiscountMicroUsdc}
            onChange={(e) => setForm({ ...form, maximumDiscountMicroUsdc: e.target.value })}
          />
          <select className="input" value={form.stackPolicy} onChange={(e) => setForm({ ...form, stackPolicy: e.target.value as "exclusive" | "stackable" })}>
            <option value="exclusive">Exclusive (does not combine with other campaigns)</option>
            <option value="stackable">Stackable (combines with other active campaigns)</option>
          </select>
          {error && <p className="text-sm text-danger">{error}</p>}
          <button className="btn btn-primary" type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create as Draft"}
          </button>
        </form>
      </div>
    </div>
  );
}

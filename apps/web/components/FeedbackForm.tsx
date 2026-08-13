"use client";

import { useState } from "react";
import { api } from "../lib/api";

const TAGS = ["fast", "high-quality", "friendly", "good-value", "fresh"];

export function FeedbackForm({ taskId, shops }: { taskId: string; shops: { merchantId: number; merchantName: string }[] }) {
  const [scores, setScores] = useState<Record<number, number>>({});
  const [tags, setTags] = useState<Record<number, string[]>>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleTag = (merchantId: number, tag: string) =>
    setTags((prev) => {
      const current = prev[merchantId] ?? [];
      return { ...prev, [merchantId]: current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag] };
    });

  const submit = async () => {
    const entries = shops
      .filter((s) => scores[s.merchantId])
      .map((s) => ({ merchantId: s.merchantId, score: scores[s.merchantId]!, tags: tags[s.merchantId] ?? [] }));
    if (entries.length === 0) return;
    try {
      await api.feedback(taskId, entries);
      setSent(true);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (sent) {
    return (
      <section className="card p-4">
        <p className="text-sm text-success">🌟 Feedback recorded — thank you!</p>
      </section>
    );
  }

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="section-title">Merchant Review</h2>
      {shops.map((shop) => (
        <div key={shop.merchantId} className="rounded-lg border border-border bg-card-2 p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium">{shop.merchantName}</span>
            <div role="radiogroup" aria-label={`${shop.merchantName} rating`} className="flex gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  role="radio"
                  aria-checked={(scores[shop.merchantId] ?? 0) === star}
                  className={`text-lg ${(scores[shop.merchantId] ?? 0) >= star ? "text-warning" : "text-muted opacity-40"}`}
                  onClick={() => setScores((prev) => ({ ...prev, [shop.merchantId]: star }))}
                >
                  ★
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TAGS.map((tag) => (
              <button
                key={tag}
                className={`badge ${(tags[shop.merchantId] ?? []).includes(tag) ? "badge-on" : ""}`}
                onClick={() => toggleTag(shop.merchantId, tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
      <button className="btn btn-primary self-start" onClick={submit}>
        Submit Feedback
      </button>
    </section>
  );
}

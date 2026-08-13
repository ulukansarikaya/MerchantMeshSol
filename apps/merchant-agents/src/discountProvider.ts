import { z } from "zod";
import { MerchantDecision, type QuoteItem } from "@merchantmesh/shared";
import type { MerchantRow } from "./db.js";

/**
 * Faz 3 — proposes a discount for `pricingPolicy.ts` to clamp; mirrors
 * apps/local-agent-bridge/src/llmProvider.ts's exact pattern (mock/real
 * provider pair, OpenAI-compatible fetch, strip-fences-then-parse, guard-rail
 * before the final zod validation). The `proposedDiscountBps` this returns is
 * NEVER the final discount — see MerchantDecision's doc comment in schemas.ts.
 */
export interface DiscountDecisionInput {
  merchant: Pick<MerchantRow, "name" | "category" | "quality_score" | "max_discount_bps" | "agent_strategy">;
  items: QuoteItem[];
  totalMicroUsdc: number;
  /** Set when this call is answering a negotiation request rather than an initial quote. */
  requestedDiscountBps?: number;
}

export interface DiscountDecisionProvider {
  readonly name: string;
  decide(input: DiscountDecisionInput): Promise<MerchantDecision>;
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic, what actually runs in tests/CI and whenever
// AI_PROVIDER != agy. Never fails, so it also doubles as the fallback target.
// ---------------------------------------------------------------------------
export class MockDiscountProvider implements DiscountDecisionProvider {
  readonly name = "mock";

  async decide(input: DiscountDecisionInput): Promise<MerchantDecision> {
    const { merchant, requestedDiscountBps } = input;
    if (merchant.max_discount_bps <= 0) {
      return { proposedDiscountBps: 0, rationale: "This merchant does not allow negotiation — the listed price applies." };
    }
    const base = requestedDiscountBps ?? Math.floor(merchant.max_discount_bps / 4);
    const strategyFactor = merchant.agent_strategy === "aggressive" ? 0.75 : merchant.agent_strategy === "conservative" ? 0.35 : 0.5;
    const proposedDiscountBps = Math.floor(Math.min(base, merchant.max_discount_bps) * strategyFactor);
    return {
      proposedDiscountBps,
      rationale: `Standard discount proposal for a ${merchant.category} merchant with a ${merchant.quality_score}/10 quality score.`,
    };
  }
}

// ---------------------------------------------------------------------------
// AGY provider — same OpenAI-compatible shape as AgyLlmProvider, applied to a
// discount proposal instead of a shopping list.
// ---------------------------------------------------------------------------
const AgyResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export class AgyDiscountProvider implements DiscountDecisionProvider {
  readonly name = "agy";

  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private model = "agy-default",
    private timeoutMs = 8000,
  ) {}

  async decide(input: DiscountDecisionInput): Promise<MerchantDecision> {
    const { merchant, items, totalMicroUsdc, requestedDiscountBps } = input;
    const itemList = items.map((i) => `- ${i.sku} x${i.qty} (birim ${i.unitPriceMicroUsdc} micro-USDC)`).join("\n");
    const system = [
      `You are a pricing assistant for "${merchant.name}" (${merchant.category}, quality score ${merchant.quality_score}/10).`,
      `The maximum merchant-authorized discount is ${merchant.max_discount_bps} basis points (bps). NEVER exceed this cap.`,
      "Return plain JSON ONLY in this schema (no markdown):",
      '{"proposedDiscountBps":0,"estimatedPrepMinutes":15,"rationale":"..."}',
      "This is NOT the final decision — it is only a proposal; a separate deterministic engine calculates the final discount.",
      "NEVER produce a final price, stock quantity, or order status — return only a discount PROPOSAL and rationale.",
    ].join("\n");
    const user = [
      `Sepet (toplam ${totalMicroUsdc} micro-USDC):`,
      itemList,
      requestedDiscountBps !== undefined ? `The customer requested a ${requestedDiscountBps} bps discount.` : "Initial quote — the customer has not negotiated yet.",
    ].join("\n");

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`AGY endpoint error ${res.status}: ${await res.text()}`);
    const parsed = AgyResponse.parse(await res.json());
    const content = parsed.choices[0]!.message.content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const raw = JSON.parse(content);

    // Guard rail: clamp into [0, 2000] before the schema's own max(2000) check
    // even sees it — belt-and-suspenders, matches AgyLlmProvider's pattern.
    if (typeof raw.proposedDiscountBps === "number") {
      raw.proposedDiscountBps = Math.max(0, Math.min(2000, Math.floor(raw.proposedDiscountBps)));
    }
    return MerchantDecision.parse(raw);
  }
}

export function createDiscountProvider(): DiscountDecisionProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "agy") {
    const baseUrl = process.env.AGY_BASE_URL;
    if (!baseUrl) {
      console.warn("[merchant-agents] AI_PROVIDER=agy but AGY_BASE_URL is unset — degrading to mock discount provider.");
      return new MockDiscountProvider();
    }
    const timeoutMs = Number(process.env.AGY_TIMEOUT_MS ?? "8000");
    return new AgyDiscountProvider(baseUrl, process.env.AGY_API_KEY, process.env.AGY_MODEL ?? "agy-default", timeoutMs);
  }
  return new MockDiscountProvider();
}

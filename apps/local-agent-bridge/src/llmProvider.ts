import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CANONICAL_SKUS, ShoppingPlan, getSku, isCanonicalSku } from "@merchantmesh/shared";

const execFileAsync = promisify(execFile);

const SKU_ALIASES: Readonly<Record<string, string>> = {
  "ground beef": "kiyma-dana",
  "minced beef": "kiyma-dana",
  "diced beef": "kusbasi-dana",
  "chicken thigh": "tavuk-but",
  "chicken thighs": "tavuk-but",
  tomato: "domates",
  tomatoes: "domates",
  onion: "sogan",
  onions: "sogan",
  parsley: "maydanoz",
  "sweet pepper": "biber-carliston",
  "sweet peppers": "biber-carliston",
  "green pepper": "biber-carliston",
  "green peppers": "biber-carliston",
  cucumber: "salatalik",
  cucumbers: "salatalik",
  bread: "ekmek",
  "bread loaf": "ekmek",
  flatbread: "lavas",
  lavash: "lavas",
  ayran: "ayran",
  "yogurt drink": "ayran",
  yogurt: "yogurt",
  egg: "yumurta",
  eggs: "yumurta",
};

function normalizedProductName(value: string): string {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[-_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCanonicalSku(value: string): string | undefined {
  if (isCanonicalSku(value)) return value;
  const normalized = normalizedProductName(value);
  const alias = SKU_ALIASES[normalized];
  if (alias) return alias;
  return CANONICAL_SKUS.find((sku) =>
    [sku.sku, sku.nameEn, sku.nameTr].some((name) => normalizedProductName(name) === normalized),
  )?.sku;
}

/**
 * LLM adapter. The model ONLY produces the shopping list (canonical SKUs +
 * quantities + essential flags) and explanations — never prices, stock or
 * discounts. Everything numeric about money comes from the merchant DB.
 */
export interface LlmProvider {
  readonly name: string;
  plan(prompt: string): Promise<ShoppingPlan>;
}

/**
 * Normalize the small amount of harmless shape drift commonly produced by
 * LLMs before applying the strict shared schema. Missing/null servings means
 * "not specified"; prices, stock and unknown SKUs are still never accepted.
 */
export function parseLlmShoppingPlan(value: unknown): ShoppingPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ShoppingPlan.parse(value);
  }

  const raw = { ...(value as Record<string, unknown>) };
  if (Array.isArray(raw.items)) {
    raw.items = raw.items
      .map((item): { sku: string; qty?: number; essential?: boolean } | null => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as { sku?: unknown; qty?: number; essential?: boolean };
        if (typeof candidate.sku !== "string") return null;
        const sku = resolveCanonicalSku(candidate.sku);
        return sku ? { ...candidate, sku } : null;
      })
      .filter((item): item is { sku: string; qty?: number; essential?: boolean } => item !== null)
      .map((item) => ({
        sku: item.sku,
        qty: typeof item.qty === "number" && Number.isFinite(item.qty) && item.qty >= 1
          ? Math.min(Math.floor(item.qty), 50)
          : 1,
        essential: typeof item.essential === "boolean" ? item.essential : getSku(item.sku).essential,
      }));
  }

  if (typeof raw.servings !== "number" || !Number.isFinite(raw.servings) || raw.servings <= 0) {
    delete raw.servings;
  } else {
    raw.servings = Math.floor(raw.servings);
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error(
      "No supported products were found. Describe groceries or a meal using products such as beef, chicken, tomatoes, onions, bread, yogurt, or eggs.",
    );
  }

  return ShoppingPlan.parse(raw);
}

// ---------------------------------------------------------------------------
// Mock provider — deterministic canned plans, demo never depends on a model
// ---------------------------------------------------------------------------
export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  async plan(prompt: string): Promise<ShoppingPlan> {
    const p = prompt.toLowerCase();

    if (/k[öo]fte/.test(p)) {
      const servings = /(\d+)\s*ki[şs]i/.exec(p)?.[1];
      return ShoppingPlan.parse({
        items: [
          { sku: "kiyma-dana", qty: 1, essential: true }, // 500g paket
          { sku: "domates", qty: 1, essential: true },
          { sku: "sogan", qty: 1, essential: true },
          { sku: "maydanoz", qty: 1, essential: true },
          { sku: "ekmek", qty: 2, essential: true },
          { sku: "ayran", qty: 1, essential: false },
        ],
        servings: servings ? Number(servings) : 4,
        explanation:
          "Meatball plan: 500g ground beef (essential), tomatoes, onions, parsley, and two loaves of bread. The yogurt drink is optional.",
      });
    }

    if (/kahvalt[ıi]/.test(p)) {
      return ShoppingPlan.parse({
        items: [
          { sku: "yumurta", qty: 1, essential: true },
          { sku: "ekmek", qty: 2, essential: true },
          { sku: "domates", qty: 1, essential: true },
          { sku: "salatalik", qty: 1, essential: false },
          { sku: "yogurt", qty: 1, essential: false },
        ],
        explanation: "Breakfast plan: eggs, fresh bread, and tomatoes; cucumbers and yogurt are optional.",
      });
    }

    // List prompt → normalize by matching canonical SKU names inside the text.
    const matched: { sku: string; qty: number; essential: boolean }[] = [];
    for (const sku of CANONICAL_SKUS) {
      const names = [sku.sku, sku.nameTr.toLowerCase().split(" ")[0]!];
      if (names.some((n) => n && p.includes(n.toLowerCase()))) {
        const qtyMatch = new RegExp(`(\\d+)\\s*(?:adet|kg|demet|paket|tane)?\\s*${names[1]}`).exec(p);
        matched.push({ sku: sku.sku, qty: qtyMatch ? Math.min(Number(qtyMatch[1]), 50) : 1, essential: sku.essential });
      }
    }
    if (matched.length > 0) {
      return ShoppingPlan.parse({
        items: matched,
        explanation: `${matched.length} items were recognized and mapped to canonical product codes.`,
      });
    }

    throw new Error(
      "Mock planner could not recognize the prompt. Try: \"I want to make meatballs for four people\" or list items such as \"tomatoes, bread, yogurt drink\".",
    );
  }
}

// ---------------------------------------------------------------------------
// AGY provider — local Antigravity endpoint, OpenAI-compatible chat shape
// ---------------------------------------------------------------------------
const AgyResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export class AgyLlmProvider implements LlmProvider {
  readonly name = "agy";

  constructor(
    private baseUrl: string,
    private apiKey?: string,
    private model = "agy-default",
  ) {}

  async plan(prompt: string): Promise<ShoppingPlan> {
    const skuList = CANONICAL_SKUS.map((s) => `- ${s.sku} (${s.nameEn}; ${s.nameTr}; ${s.category}; unit: ${s.unit})`).join("\n");
    const system = [
      "You are a shopping planning assistant. Convert the user's English cooking or shopping request into an ingredient list.",
      "You may use ONLY the following canonical SKUs:",
      skuList,
      'Return plain JSON ONLY in this schema (no markdown): {"items":[{"sku":"...","qty":1,"essential":true}],"servings":4,"explanation":"..."}',
      "NEVER invent prices, stock, or discounts — return only the list and explanation.",
    ].join("\n");

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AGY endpoint error ${res.status}: ${await res.text()}`);
    const parsed = AgyResponse.parse(await res.json());
    const content = parsed.choices[0]!.message.content
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "");
    const raw = JSON.parse(content);

    return parseLlmShoppingPlan(raw);
  }
}

// AGY CLI provider — uses the user's authenticated local Antigravity session.
export class AgyCliLlmProvider implements LlmProvider {
  readonly name = "agy-cli";

  async plan(prompt: string): Promise<ShoppingPlan> {
    const skuList = CANONICAL_SKUS.map((s) => `${s.sku} (${s.nameEn}; ${s.nameTr}; ${s.unit})`).join(", ");
    const instruction = [
      "Convert the shopping request below into canonical products.",
      `Allowed SKUs only: ${skuList}`,
      'Return JSON only: {"items":[{"sku":"...","qty":1,"essential":true}],"servings":4,"explanation":"..."}',
      "Never invent prices, stock, discounts, distance, payment, or order state.",
      `User request: ${prompt}`,
    ].join("\n");
    const childEnv = { ...process.env };
    for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete childEnv[key];
    childEnv.NO_PROXY = "localhost,127.0.0.1,::1";
    const { stdout } = await execFileAsync("agy", ["--print", instruction, "--print-timeout", "60s"], {
      env: childEnv,
      timeout: 70_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const content = stdout.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const raw = JSON.parse(content);
    return parseLlmShoppingPlan(raw);
  }
}

export function createLlmProvider(): LlmProvider {
  const provider = process.env.AI_PROVIDER ?? "mock";
  if (provider === "agy-cli") return new AgyCliLlmProvider();
  if (provider === "agy") {
    const baseUrl = process.env.AGY_BASE_URL;
    if (!baseUrl) {
      console.warn("[bridge] AI_PROVIDER=agy but AGY_BASE_URL is unset — degrading to mock planner.");
      return new MockLlmProvider();
    }
    return new AgyLlmProvider(baseUrl, process.env.AGY_API_KEY, process.env.AGY_MODEL ?? "agy-default");
  }
  return new MockLlmProvider();
}

import { describe, expect, it } from "vitest";
import { parseLlmShoppingPlan } from "../src/llmProvider.js";

describe("LLM shopping-plan normalization", () => {
  it("treats null servings as unspecified", () => {
    const plan = parseLlmShoppingPlan({
      items: [{ sku: "ekmek", qty: 1, essential: true }],
      servings: null,
      explanation: "Bread",
    });

    expect(plan.servings).toBeUndefined();
  });

  it("keeps strict catalog guard rails while normalizing quantities", () => {
    const plan = parseLlmShoppingPlan({
      items: [
        { sku: "ekmek", qty: 2.8 },
        { sku: "not-a-real-sku", qty: 1 },
      ],
      servings: 4.9,
      explanation: "Bread",
    });

    expect(plan.items).toEqual([{ sku: "ekmek", qty: 2, essential: true }]);
    expect(plan.servings).toBe(4);
  });

  it("maps ordinary English product names to canonical SKUs", () => {
    const plan = parseLlmShoppingPlan({
      items: [
        { sku: "ground beef", qty: 1, essential: true },
        { sku: "tomatoes", qty: 2, essential: true },
        { sku: "bread loaf", qty: 1, essential: true },
      ],
      servings: null,
      explanation: "Dinner groceries",
    });

    expect(plan.items.map((item) => item.sku)).toEqual(["kiyma-dana", "domates", "ekmek"]);
  });

  it("returns a useful error instead of exposing a raw empty-array schema error", () => {
    expect(() =>
      parseLlmShoppingPlan({
        items: [{ sku: "wallet balance", qty: 1 }],
        explanation: "Not a shopping request",
      }),
    ).toThrow("No supported products were found");
  });
});

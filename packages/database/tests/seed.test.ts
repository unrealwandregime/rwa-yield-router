import { CATEGORY_WEIGHTS_V1, RISK_FACTORS } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  assertCanonicalMethodologyWeights,
  buildCanonicalMethodologyWeightRows
} from "../src/seed.js";

const categoryCodes = [
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
] as const satisfies readonly (keyof typeof CATEGORY_WEIGHTS_V1)[];

const categoryIds = new Map(
  categoryCodes.map((category, index) => [category, `category-${index}`])
);

describe("canonical methodology seed", () => {
  it("builds all 96 exact category-factor weights deterministically", () => {
    const first = buildCanonicalMethodologyWeightRows(
      "10000000-0000-4000-8000-000000000101",
      categoryIds
    );
    const second = buildCanonicalMethodologyWeightRows(
      "10000000-0000-4000-8000-000000000101",
      categoryIds
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(Object.keys(CATEGORY_WEIGHTS_V1).length * RISK_FACTORS.length);
    for (const categoryId of categoryIds.values()) {
      const total = first
        .filter((row) => row.categoryId === categoryId)
        .reduce((sum, row) => sum.plus(row.weight), new Decimal(0));
      expect(total.toString()).toBe("1");
    }
  });

  it("fails closed when a persisted published weight drifts", () => {
    const seededRows = buildCanonicalMethodologyWeightRows(
      "10000000-0000-4000-8000-000000000101",
      categoryIds
    );
    const rows = categoryCodes.flatMap((category) =>
      RISK_FACTORS.map((factorCode, index) => {
        const categoryId = categoryIds.get(category);
        const seeded = seededRows.find(
          (row) => row.categoryId === categoryId && row.factorCode === factorCode
        );
        if (seeded === undefined) throw new Error("Test setup could not find a canonical weight");
        return {
          category,
          factorCode,
          weight: category === categoryCodes[0] && index === 0 ? "0.9999999999" : seeded.weight
        };
      })
    );

    expect(() => assertCanonicalMethodologyWeights(rows)).toThrow(/drift|total/u);
  });
});

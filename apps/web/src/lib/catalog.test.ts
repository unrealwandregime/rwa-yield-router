import { describe, expect, it } from "vitest";
import { catalogStats, getCatalog } from "@/lib/catalog";

describe("production catalog boundary", () => {
  it("exposes real sourced research across all six categories", () => {
    const records = getCatalog();
    expect(new Set(records.map((record) => record.category)).size).toBe(6);
    expect(records.every((record) => record.source.url.startsWith("https://"))).toBe(true);
  });

  it("never coerces missing financial metrics to zero", () => {
    const records = getCatalog();
    expect(records.some((record) => record.grossApy === null)).toBe(true);
    expect(catalogStats().researched).toBe(records.length);
    expect(catalogStats().published).toBeLessThanOrEqual(records.length);
  });

  it("reports admitted and gated coverage separately for every category", () => {
    const stats = catalogStats();

    expect(stats.researched).toBe(60);
    expect(stats.admitted).toBe(26);
    expect(stats.published).toBe(stats.admitted);
    expect(stats.gated).toBe(34);
    expect(stats.researchedCategories).toBe(6);
    expect(stats.admittedCategories).toBe(6);
    expect(stats.categoryCoverage).toEqual({
      CASH_EQUIVALENT: { admitted: 1, gated: 9, researched: 10 },
      DEFI_LENDING: { admitted: 1, gated: 9, researched: 10 },
      GOLD_BACKED_TOKEN: { admitted: 4, gated: 6, researched: 10 },
      MONEY_MARKET_TOKEN: { admitted: 1, gated: 9, researched: 10 },
      STABLECOIN_VAULT: { admitted: 10, gated: 0, researched: 10 },
      TOKENIZED_TBILL: { admitted: 9, gated: 1, researched: 10 }
    });
  });
});

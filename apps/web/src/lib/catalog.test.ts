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
});

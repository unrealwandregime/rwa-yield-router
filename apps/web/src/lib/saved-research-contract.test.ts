import { describe, expect, it } from "vitest";

import {
  comparisonRouteSlugsSchema,
  savedComparisonUpdateSchema,
  savedViewCreateSchema,
  SCREENER_COLUMN_VALUES
} from "@/lib/saved-research-contract";

describe("saved research contracts", () => {
  it("accepts only two to five unique canonical comparison route slugs", () => {
    expect(comparisonRouteSlugsSchema.safeParse(["route-a", "route-b"]).success).toBe(true);
    expect(comparisonRouteSlugsSchema.safeParse(["route-a"]).success).toBe(false);
    expect(comparisonRouteSlugsSchema.safeParse(["route-a", "route-a"]).success).toBe(false);
    expect(
      comparisonRouteSlugsSchema.safeParse([
        "route-a",
        "route-b",
        "route-c",
        "route-d",
        "route-e",
        "route-f"
      ]).success
    ).toBe(false);
  });

  it("allows independent comparison renames and target replacement", () => {
    const id = "76d5b2fe-8d2f-4d18-96a8-6fe4576f594e";

    expect(savedComparisonUpdateSchema.safeParse({ id, name: "Renamed" }).success).toBe(true);
    expect(
      savedComparisonUpdateSchema.safeParse({ id, routeSlugs: ["route-a", "route-b"] }).success
    ).toBe(true);
    expect(savedComparisonUpdateSchema.safeParse({ id }).success).toBe(false);
  });

  it("rejects unknown filters, sort keys, and visible columns", () => {
    const valid = {
      filters: { category: null, chain: "Base", confidence: "DIRECT_API", query: "usdc" },
      name: "Base USDC",
      sort: { key: "grossApy" },
      visibleColumns: [...SCREENER_COLUMN_VALUES]
    };

    expect(savedViewCreateSchema.safeParse(valid).success).toBe(true);
    expect(
      savedViewCreateSchema.safeParse({ ...valid, filters: { ...valid.filters, x: 1 } }).success
    ).toBe(false);
    expect(
      savedViewCreateSchema.safeParse({ ...valid, sort: { key: "highestUnknown" } }).success
    ).toBe(false);
    expect(
      savedViewCreateSchema.safeParse({ ...valid, visibleColumns: ["product", "secret"] }).success
    ).toBe(false);
    expect(
      savedViewCreateSchema.safeParse({
        ...valid,
        filters: { ...valid.filters, confidence: "UNRECOGNIZED_CONFIDENCE" }
      }).success
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  createPublishedCatalogImportPayload,
  getCatalogRecordBySlug,
  productionCatalog,
  validateProductionCatalog
} from "./catalog.js";

describe("production catalog", () => {
  it("contains sixty sourced records across all categories without live metrics", () => {
    const report = validateProductionCatalog();

    expect(report.total).toBe(60);
    expect(Object.values(report.categoryCounts)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(productionCatalog.every((record) => record.source.url.startsWith("https://"))).toBe(
      true
    );
    expect(productionCatalog.every((record) => record.grossApy === null)).toBe(true);
  });

  it("publishes only identity-confirmed metadata", () => {
    expect(
      productionCatalog.every(
        (record) =>
          (record.publicationStatus === "PUBLISHED") === (record.status === "IDENTITY_CONFIRMED")
      )
    ).toBe(true);
  });

  it("returns stable slug records and a metric-free persistence payload", () => {
    expect(getCatalogRecordBySlug("ondo-ousg-ethereum")?.id).toBe("TB-01");
    const payload = createPublishedCatalogImportPayload();
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.every((record) => record.stableRouteSlug.length > 0)).toBe(true);
    expect("grossApy" in (payload[0] ?? {})).toBe(false);
  });
});

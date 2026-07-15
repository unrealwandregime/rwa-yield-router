import { RISK_FACTORS, RISK_METHODOLOGY_V1 } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { getCatalog, type CatalogRecord } from "@/lib/catalog";
import { CATEGORY_VALUES } from "@/lib/constants";
import {
  buildDatabaseMethodology,
  mergeCatalogPublication,
  resolveMetricState
} from "@/lib/public-read-model-core";

describe("public read-model selection", () => {
  it("retains a last valid value but marks it stale from economic time", () => {
    const state = resolveMetricState(
      {
        confidence: "DIRECT_API",
        freshnessThresholdSeconds: 900,
        hasValue: true,
        observedAt: new Date("2026-07-14T00:00:00.000Z"),
        sourceStatus: "ACTIVE",
        status: "AVAILABLE"
      },
      new Date("2026-07-14T00:15:00.001Z")
    );
    expect(state).toEqual({
      confidence: "STALE",
      observedAt: "2026-07-14T00:00:00.000Z",
      status: "STALE"
    });
  });

  it("keeps unavailable distinct from a sourced zero", () => {
    const unavailable = resolveMetricState(
      {
        confidence: "UNAVAILABLE",
        freshnessThresholdSeconds: 900,
        hasValue: false,
        observedAt: new Date("2026-07-14T00:00:00.000Z"),
        sourceStatus: "ACTIVE",
        status: "UNAVAILABLE"
      },
      new Date("2026-07-14T00:00:01.000Z")
    );
    const zero = resolveMetricState(
      {
        confidence: "DIRECT_API",
        freshnessThresholdSeconds: 900,
        hasValue: true,
        observedAt: new Date("2026-07-14T00:00:00.000Z"),
        sourceStatus: "ACTIVE",
        status: "AVAILABLE"
      },
      new Date("2026-07-14T00:00:01.000Z")
    );
    expect(unavailable.status).toBe("UNAVAILABLE");
    expect(zero.status).toBe("CURRENT");
  });

  it("lets database publication and lifecycle override only controlled admitted records", () => {
    const bundled = getCatalog();
    const admitted = bundled.find((record) => record.publicationStatus === "PUBLISHED");
    const gated = bundled.find((record) => record.publicationStatus === "GATED");
    if (admitted === undefined || gated === undefined)
      throw new Error("Catalog fixture is incomplete");
    const replacement: CatalogRecord = {
      ...admitted,
      routeName: "Database-published route version"
    };
    const newlyPublished: CatalogRecord = {
      ...admitted,
      id: "10000000-0000-4000-8000-000000000999",
      productSlug: "new-database-product",
      routeName: "New database route",
      slug: "new-database-route"
    };
    const merged = mergeCatalogPublication(
      bundled,
      [replacement, newlyPublished],
      new Set([admitted.slug, gated.slug])
    );

    expect(merged.find((record) => record.slug === admitted.slug)?.routeName).toBe(
      replacement.routeName
    );
    expect(merged.find((record) => record.slug === gated.slug)?.publicationStatus).toBe("GATED");
    expect(merged.some((record) => record.slug === newlyPublished.slug)).toBe(true);

    const archived = mergeCatalogPublication(bundled, [], new Set([admitted.slug]));
    expect(archived.some((record) => record.slug === admitted.slug)).toBe(false);
  });
});

describe("effective database methodology mapping", () => {
  const weights = CATEGORY_VALUES.flatMap((category) =>
    RISK_FACTORS.map((factorCode) => ({
      category,
      factorCode,
      weight: new Decimal(RISK_METHODOLOGY_V1.categoryWeights[category][factorCode])
        .div(100)
        .toFixed(10)
    }))
  );
  const row = {
    calculationVersion: "risk-engine-v1.0.0",
    configuration: {
      maxAnnualPenaltyPp: "12",
      methodologyDocument: "RISK_METHODOLOGY.md",
      minimumEvidenceCoveragePct: "70",
      semanticVersion: "1.0.0",
      unknownRiskProxy: "75"
    },
    createdAt: new Date("2026-07-13T00:00:00.000Z"),
    description: "Published comparative methodology.",
    effectiveFrom: new Date("2026-07-13T00:00:00.000Z"),
    effectiveTo: null,
    id: "10000000-0000-4000-8000-000000000101",
    publicationStatus: "PUBLISHED" as const,
    publishedAt: new Date("2026-07-13T00:00:00.000Z"),
    publishedByUserId: "10000000-0000-4000-8000-000000000102",
    reviewedByUserId: "10000000-0000-4000-8000-000000000103",
    version: "1.0.0"
  };

  it("maps all exact ratio weights into risk-engine percentage points", () => {
    const effective = buildDatabaseMethodology(row, weights);
    expect(effective.source).toBe("DATABASE");
    expect(effective.methodology.semanticVersion).toBe("1.0.0");
    expect(effective.methodology.categoryWeights).toEqual(RISK_METHODOLOGY_V1.categoryWeights);
  });

  it("fails closed when any published category weight is missing", () => {
    expect(() => buildDatabaseMethodology(row, weights.slice(1))).toThrow(/expected/u);
  });
});

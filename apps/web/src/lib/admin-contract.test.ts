import { CATEGORY_WEIGHTS_V1, RISK_FACTORS } from "@rwa-yield-router/risk-engine";
import { describe, expect, it } from "vitest";
import { adminActionSchema, methodologyWeightSchema, toCsvCell } from "@/lib/admin-contract";
import { CATEGORY_VALUES } from "@/lib/constants";

const validWeights = CATEGORY_VALUES.flatMap((category) =>
  RISK_FACTORS.map((factorCode) => ({
    category,
    factorCode,
    weightPct: CATEGORY_WEIGHTS_V1[category][factorCode]
  }))
);

describe("admin operation contracts", () => {
  it("accepts a complete exact methodology weight set", () => {
    expect(methodologyWeightSchema.safeParse(validWeights).success).toBe(true);
  });

  it("rejects incomplete, duplicate, and non-100-percent category weights", () => {
    const wrongTotal = validWeights.map((weight) =>
      weight.category === "TOKENIZED_TBILL" && weight.factorCode === "LIQUIDITY"
        ? { ...weight, weightPct: "14.9999999999" }
        : weight
    );
    const duplicated = validWeights.map((weight) =>
      weight.category === "TOKENIZED_TBILL" && weight.factorCode === "REDEMPTION"
        ? { ...weight, factorCode: "LIQUIDITY" as const }
        : weight
    );
    expect(methodologyWeightSchema.safeParse(wrongTotal).success).toBe(false);
    expect(methodologyWeightSchema.safeParse(duplicated).success).toBe(false);
    expect(methodologyWeightSchema.safeParse(validWeights.slice(1)).success).toBe(false);
  });

  it("requires a sourced, reasoned, HTTPS entity mutation", () => {
    const base = {
      action: "ENTITY_UPSERT",
      caip2Id: null,
      entityType: "ISSUER",
      explorerBaseUrl: null,
      finalityBlocks: null,
      id: null,
      jurisdictionIsoCode: null,
      legalName: "Example Issuer LLC",
      lifecycleStatus: "ACTIVE",
      name: "Example Issuer",
      officialUrl: "https://issuer.example",
      reason: "Verified against the official issuer disclosure.",
      sourceId: "10000000-0000-4000-8000-000000000001",
      verificationDate: "2026-07-14T00:00:00.000Z"
    };
    expect(adminActionSchema.safeParse(base).success).toBe(true);
    expect(
      adminActionSchema.safeParse({ ...base, officialUrl: "http://issuer.example" }).success
    ).toBe(false);
    expect(adminActionSchema.safeParse({ ...base, reason: "short" }).success).toBe(false);
    expect(adminActionSchema.safeParse({ ...base, sourceId: "not-a-uuid" }).success).toBe(false);
  });

  it("fails closed on conditional eligibility without conditions", () => {
    const result = adminActionSchema.safeParse({
      action: "ACCESS_TERMS_VERSION",
      eligibility: {
        conditionsText: null,
        eligibilityStatus: "CONDITIONAL",
        investorClassification: "RETAIL",
        jurisdictionIsoCode: "USA",
        jurisdictionName: "United States",
        requiresKyc: null
      },
      reason: "Reviewed official access documentation.",
      redemption: null,
      routeId: "10000000-0000-4000-8000-000000000001",
      sourceId: "10000000-0000-4000-8000-000000000002",
      sourceLinkUrl: null,
      verificationDate: "2026-07-14T00:00:00.000Z"
    });
    expect(result.success).toBe(false);
  });

  it("neutralizes spreadsheet formulas and quotes CSV fields", () => {
    expect(toCsvCell('=HYPERLINK("https://attacker.invalid")')).toBe(
      '"\'=HYPERLINK(""https://attacker.invalid"")"'
    );
    expect(toCsvCell("plain, value")).toBe('"plain, value"');
    expect(toCsvCell(null)).toBe('""');
  });
});

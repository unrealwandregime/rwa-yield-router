import { describe, expect, it } from "vitest";

import { neutralizeCsvFormula, parseCsvRows, validateImportDocument } from "./import.js";

const validRecord = {
  accessMethod: "Issuer access after eligibility review",
  category: "TOKENIZED_TBILL",
  chain: "Ethereum",
  confidence: "MANUALLY_VERIFIED",
  effectiveAt: "2026-07-13T00:00:00.000Z",
  eligibilitySummary: "Eligibility requires issuer review.",
  issuer: "Verified issuer",
  kycRequired: true,
  nativeYield: null,
  productName: "Verified product",
  protocol: null,
  publicationStatus: "GATED",
  redemptionSummary: "Redemption requires issuer review.",
  reverifyAt: "2027-07-13T00:00:00.000Z",
  reviewStatus: "DRAFT",
  routeName: "Verified route",
  sourceId: "SOURCE-1",
  sourceName: "Official source",
  sourceType: "OFFICIAL_DOCUMENT",
  sourceUrl: "https://issuer.example.com/product",
  stableProductSlug: "verified-product",
  stableRouteSlug: "verified-product-ethereum",
  symbol: "VP",
  underlyingAsset: "U.S. Treasuries",
  verifiedAt: "2026-07-13T00:00:00.000Z",
  yieldSource: "TREASURY_COUPON"
};

describe("manual imports", () => {
  it("defaults to a gated review workflow", () => {
    const record = { ...validRecord };
    delete (record as Partial<typeof validRecord>).reviewStatus;
    const result = validateImportDocument(
      { records: [record], schemaVersion: "1.0.0" },
      { now: new Date("2026-07-14T00:00:00.000Z") }
    );
    expect(result.records[0]?.reviewStatus).toBe("DRAFT");
  });

  it("rejects duplicate routes and formula-bearing cells", () => {
    expect(() =>
      validateImportDocument(
        { records: [validRecord, validRecord], schemaVersion: "1.0.0" },
        { now: new Date("2026-07-14T00:00:00.000Z") }
      )
    ).toThrow(/Duplicate route/u);
    expect(() =>
      validateImportDocument(
        {
          records: [{ ...validRecord, productName: ' =HYPERLINK("bad")' }],
          schemaVersion: "1.0.0"
        },
        { now: new Date("2026-07-14T00:00:00.000Z") }
      )
    ).toThrow(/formula/u);
  });

  it("parses RFC 4180 quoted cells and neutralizes export formulas", () => {
    expect(parseCsvRows('name,notes\r\n"Product, One","line ""quoted"""')).toEqual([
      ["name", "notes"],
      ["Product, One", 'line "quoted"']
    ]);
    expect(neutralizeCsvFormula("  =1+1")).toBe("'  =1+1");
  });
});

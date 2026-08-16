import { describe, expect, it } from "vitest";

import {
  createPublishedCatalogImportPayload,
  getCatalogRecordBySlug,
  productionCatalog,
  validateProductionCatalog
} from "./catalog.js";

describe("production catalog", () => {
  it("distinguishes researched, admitted, and gated coverage in every category", () => {
    const report = validateProductionCatalog();

    expect(report.total).toBe(60);
    expect(report.researched).toBe(60);
    expect(report.admitted).toBe(26);
    expect(report.published).toBe(report.admitted);
    expect(report.gated).toBe(34);
    expect(Object.values(report.categoryCounts)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(report.categoryCoverage).toEqual({
      CASH_EQUIVALENT: { admitted: 1, gated: 9, researched: 10 },
      DEFI_LENDING: { admitted: 1, gated: 9, researched: 10 },
      GOLD_BACKED_TOKEN: { admitted: 4, gated: 6, researched: 10 },
      MONEY_MARKET_TOKEN: { admitted: 1, gated: 9, researched: 10 },
      STABLECOIN_VAULT: { admitted: 10, gated: 0, researched: 10 },
      TOKENIZED_TBILL: { admitted: 9, gated: 1, researched: 10 }
    });
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

  it("admits the three reverified identities without inventing live evidence", () => {
    const admitted = [
      {
        category: "DEFI_LENDING",
        chain: "Ethereum",
        id: "DL-01",
        nativeYield: null,
        slug: "aave-v3-usdc-ethereum",
        sourceUrl: "https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Ethereum.sol",
        verifiedAt: "2026-07-18T00:00:00.000Z"
      },
      {
        category: "MONEY_MARKET_TOKEN",
        chain: "Ethereum",
        id: "MM-06",
        nativeYield: null,
        slug: "circle-usyc-ethereum",
        sourceUrl: "https://developers.circle.com/tokenized/usyc/smart-contracts",
        verifiedAt: "2026-07-18T00:00:00.000Z"
      },
      {
        category: "CASH_EQUIVALENT",
        chain: "Ethereum",
        id: "CE-01",
        nativeYield: "0",
        slug: "usdc-base-asset",
        sourceUrl: "https://developers.circle.com/stablecoins/usdc-contract-addresses",
        verifiedAt: "2026-07-18T00:00:00.000Z"
      }
    ] as const;

    for (const expected of admitted) {
      const record = getCatalogRecordBySlug(expected.slug);
      expect(record).toMatchObject({
        category: expected.category,
        chain: expected.chain,
        id: expected.id,
        nativeYield: expected.nativeYield,
        publicationStatus: "PUBLISHED",
        source: { url: expected.sourceUrl },
        status: "IDENTITY_CONFIRMED",
        verifiedAt: expected.verifiedAt
      });
      expect([
        record?.grossApy,
        record?.netApy,
        record?.riskAdjustedApy,
        record?.riskScore,
        record?.aumTvlUsd,
        record?.liquidityUsd,
        record?.observedAt
      ]).toEqual([null, null, null, null, null, null, null]);
    }

    expect(getCatalogRecordBySlug("ondo-ousg-ethereum")?.verifiedAt).toBe(
      "2026-07-13T00:00:00.000Z"
    );
    expect(getCatalogRecordBySlug("aave-v3-usdt-ethereum")).toMatchObject({
      sourceVerifiedAt: "2026-07-18T00:00:00.000Z",
      verifiedAt: "2026-07-13T00:00:00.000Z"
    });
  });

  it("returns stable slug records and a metric-free persistence payload", () => {
    expect(getCatalogRecordBySlug("ondo-ousg-ethereum")?.id).toBe("TB-01");
    const payload = createPublishedCatalogImportPayload();
    expect(payload.length).toBeGreaterThan(0);
    expect(payload.every((record) => record.stableRouteSlug.length > 0)).toBe(true);
    expect("grossApy" in (payload[0] ?? {})).toBe(false);
  });

  it("rejects conflicting metadata for one source identifier", () => {
    const sharedSourceRecords = productionCatalog.filter(
      (record) => record.source.id === "MORPHO-API"
    );
    const target = sharedSourceRecords[1];
    if (target === undefined) throw new Error("Expected two Morpho catalog records");
    const conflicted = productionCatalog.map((record) =>
      record.id === target.id
        ? { ...record, source: { ...record.source, name: "Conflicting source name" } }
        : record
    );

    expect(() => validateProductionCatalog(conflicted)).toThrow(/Conflicting source identity/u);
  });
});

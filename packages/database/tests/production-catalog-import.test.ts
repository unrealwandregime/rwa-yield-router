import { productionCatalog } from "@rwa-yield-router/data-adapters";
import { describe, expect, it } from "vitest";

import {
  buildProductionCatalogImportPlan,
  caip2IdForCatalogChain
} from "../src/production-catalog-import.js";

describe("production catalog import planning", () => {
  it("preserves the reviewed 60-record admission split", () => {
    const plan = buildProductionCatalogImportPlan();

    expect(plan.recordCount).toBe(60);
    expect(plan.publishedCount).toBe(23);
    expect(plan.gatedCount).toBe(37);
    expect(plan.draftCount).toBe(0);
    expect(plan.payloadSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(plan.records.every((record) => record.grossApy === null)).toBe(true);
  });

  it("hashes records deterministically regardless of input order", () => {
    const forward = buildProductionCatalogImportPlan(productionCatalog);
    const reverse = buildProductionCatalogImportPlan([...productionCatalog].reverse());

    expect(reverse.payloadSha256).toBe(forward.payloadSha256);
    expect(reverse.records.map((record) => record.id)).toEqual(
      forward.records.map((record) => record.id)
    );
  });

  it("uses canonical chain identifiers and does not invent one for off-chain venues", () => {
    expect(caip2IdForCatalogChain("Ethereum")).toBe("eip155:1");
    expect(caip2IdForCatalogChain("Base")).toBe("eip155:8453");
    expect(caip2IdForCatalogChain("Solana")).toMatch(/^solana:/u);
    expect(caip2IdForCatalogChain("WisdomTree Prime")).toBeNull();
    expect(caip2IdForCatalogChain("Multi-chain")).toBeNull();
  });
});

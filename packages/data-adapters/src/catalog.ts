import { z } from "zod";

import catalogDocument from "../data/production-catalog.json" with { type: "json" };

import {
  confidenceSchema,
  normalizedSourceSchema,
  productCategorySchema,
  yieldSourceSchema,
  type Confidence,
  type ProductCategory,
  type YieldSource
} from "./types.js";

const discoveryStatusSchema = z.enum(["IDENTITY_CONFIRMED", "SOURCE_CONFIRMED", "ADMISSION_GATED"]);
const publicationStatusSchema = z.enum(["PUBLISHED", "GATED", "ARCHIVED"]);
const sourceWithoutIdSchema = normalizedSourceSchema.omit({ id: true });
const catalogRowSchema = z.tuple([
  z.string().regex(/^(?:TB|SV|DL|MM|GL|CE)-\d{2}$/u),
  z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  z.string().trim().min(1).max(200),
  z.string().trim().min(1).max(32),
  z.string().trim().min(1).max(240),
  productCategorySchema,
  z.string().trim().min(1).max(80),
  z.string().trim().min(1).max(100),
  z.string().trim().min(1).max(100).nullable(),
  z.string().trim().min(1).max(120),
  discoveryStatusSchema,
  z.boolean().nullable(),
  confidenceSchema,
  z.string().trim().min(1).max(80)
]);
const catalogDocumentSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    researchSnapshot: z.iso.date(),
    verifiedAt: z.iso.datetime({ offset: true }),
    columns: z.array(z.string()).length(14),
    sources: z.record(z.string(), sourceWithoutIdSchema),
    records: z.array(catalogRowSchema).min(60)
  })
  .strict();

export const productionCatalogRecordSchema = z
  .object({
    id: z.string().min(1),
    slug: z.string().min(1),
    productName: z.string().min(1),
    symbol: z.string().min(1),
    routeName: z.string().min(1),
    category: productCategorySchema,
    chain: z.string().min(1),
    issuer: z.string().min(1),
    protocol: z.string().nullable(),
    underlyingAsset: z.string().min(1),
    yieldSource: yieldSourceSchema,
    accessMethod: z.string().min(1),
    status: discoveryStatusSchema,
    publicationStatus: publicationStatusSchema,
    kycRequired: z.boolean().nullable(),
    eligibilitySummary: z.string().min(1),
    redemptionSummary: z.string().min(1),
    nativeYield: z.string().nullable(),
    grossApy: z.string().nullable(),
    netApy: z.string().nullable(),
    riskAdjustedApy: z.string().nullable(),
    riskScore: z.string().nullable(),
    aumTvlUsd: z.string().nullable(),
    liquidityUsd: z.string().nullable(),
    confidence: confidenceSchema,
    observedAt: z.iso.datetime({ offset: true }).nullable(),
    verifiedAt: z.iso.datetime({ offset: true }),
    source: normalizedSourceSchema,
    warnings: z.array(z.string().min(1))
  })
  .strict();

export type ProductionCatalogRecord = z.infer<typeof productionCatalogRecordSchema>;

interface CategoryDefaults {
  readonly yieldSource: YieldSource;
  readonly accessMethod: string;
  readonly eligibilitySummary: string;
  readonly redemptionSummary: string;
  readonly nativeYield: string | null;
}

const categoryDefaults: Readonly<Record<ProductCategory, CategoryDefaults>> = {
  TOKENIZED_TBILL: {
    accessMethod: "Issuer mint or secondary acquisition after eligibility review",
    eligibilitySummary:
      "Issuer eligibility, jurisdiction, and transfer restrictions require current verification; global retail access is not assumed.",
    nativeYield: null,
    redemptionSummary:
      "Current issuer redemption terms, cutoffs, fees, and settlement timing require verification.",
    yieldSource: "TREASURY_COUPON"
  },
  STABLECOIN_VAULT: {
    accessMethod: "Read-only analytics for a vault deposit route; no transaction construction",
    eligibilitySummary:
      "Protocol, interface, asset, and jurisdiction restrictions require runtime verification.",
    nativeYield: null,
    redemptionSummary:
      "Withdrawal queues, caps, liquidity, pause state, and underlying market state require live verification.",
    yieldSource: "VAULT_STRATEGY"
  },
  DEFI_LENDING: {
    accessMethod: "Read-only analytics for a lending supply route; no transaction construction",
    eligibilitySummary:
      "Canonical deployment and current protocol or interface restrictions require verification.",
    nativeYield: null,
    redemptionSummary:
      "Withdrawal availability depends on live pause, freeze, cap, utilization, and liquidity state.",
    yieldSource: "BORROWER_INTEREST"
  },
  MONEY_MARKET_TOKEN: {
    accessMethod: "Issuer or approved platform access after eligibility review",
    eligibilitySummary:
      "Current offering documents, investor class, jurisdiction, and transfer restrictions require review.",
    nativeYield: null,
    redemptionSummary:
      "Current fund or issuer redemption terms and platform operating status require verification.",
    yieldSource: "MONEY_MARKET_INCOME"
  },
  GOLD_BACKED_TOKEN: {
    accessMethod:
      "Native token holding route only; lending or vault wrappers are modeled separately",
    eligibilitySummary:
      "Issuer terms, supported jurisdictions, transfer rules, and chain deployment require verification.",
    nativeYield: "0",
    redemptionSummary:
      "Physical or cash redemption eligibility, minimums, fees, and settlement are issuer-specific.",
    yieldSource: "NO_NATIVE_YIELD"
  },
  CASH_EQUIVALENT: {
    accessMethod: "Base-token holding route; lending and savings wrappers are modeled separately",
    eligibilitySummary:
      "Availability, issuance, redemption, and jurisdiction restrictions vary by issuer and chain.",
    nativeYield: "0",
    redemptionSummary:
      "Issuer redemption access and settlement terms require current verification.",
    yieldSource: "NO_NATIVE_YIELD"
  }
};

function warningsFor(
  category: ProductCategory,
  status: z.infer<typeof discoveryStatusSchema>
): ReadonlyArray<string> {
  const warnings = [
    status === "IDENTITY_CONFIRMED"
      ? "Identity metadata is sourced; live financial metrics remain unavailable until fresh observations pass admission."
      : "This discovery record is gated and is not an available route."
  ];
  if (category === "GOLD_BACKED_TOKEN") {
    warnings.push("Gold-price movement is return exposure, not yield.");
  }
  if (category === "CASH_EQUIVALENT") {
    warnings.push("Issuer reserve income is not native holder yield.");
  }
  return warnings;
}

function normalizeDocument(input: unknown): ReadonlyArray<ProductionCatalogRecord> {
  const document = catalogDocumentSchema.parse(input);
  return document.records.map((row) => {
    const [
      id,
      slug,
      productName,
      symbol,
      routeName,
      category,
      chain,
      issuer,
      protocol,
      underlyingAsset,
      status,
      kycRequired,
      confidence,
      sourceId
    ] = row;
    const source = document.sources[sourceId];
    if (source === undefined) {
      throw new Error("Catalog record " + id + " references an unknown source");
    }
    const defaults = categoryDefaults[category];
    return productionCatalogRecordSchema.parse({
      accessMethod: defaults.accessMethod,
      aumTvlUsd: null,
      category,
      chain,
      confidence,
      eligibilitySummary: defaults.eligibilitySummary,
      grossApy: null,
      id,
      issuer,
      kycRequired,
      liquidityUsd: null,
      nativeYield: defaults.nativeYield,
      netApy: null,
      observedAt: null,
      productName,
      protocol,
      publicationStatus: status === "IDENTITY_CONFIRMED" ? "PUBLISHED" : "GATED",
      redemptionSummary: defaults.redemptionSummary,
      riskAdjustedApy: null,
      riskScore: null,
      routeName,
      slug,
      source: { ...source, id: sourceId },
      status,
      symbol,
      underlyingAsset,
      verifiedAt: document.verifiedAt,
      warnings: warningsFor(category, status),
      yieldSource: defaults.yieldSource
    });
  });
}

export interface CatalogValidationReport {
  readonly valid: true;
  readonly total: number;
  readonly published: number;
  readonly gated: number;
  readonly categoryCounts: Readonly<Record<ProductCategory, number>>;
}

export function validateProductionCatalog(
  records: ReadonlyArray<ProductionCatalogRecord> = productionCatalog
): CatalogValidationReport {
  const parsed = z.array(productionCatalogRecordSchema).min(60).parse(records);
  const ids = new Set<string>();
  const slugs = new Set<string>();
  const categoryCounts: Record<ProductCategory, number> = {
    TOKENIZED_TBILL: 0,
    STABLECOIN_VAULT: 0,
    DEFI_LENDING: 0,
    MONEY_MARKET_TOKEN: 0,
    GOLD_BACKED_TOKEN: 0,
    CASH_EQUIVALENT: 0
  };
  for (const record of parsed) {
    if (ids.has(record.id) || slugs.has(record.slug)) {
      throw new Error("Duplicate catalog id or slug: " + record.id);
    }
    ids.add(record.id);
    slugs.add(record.slug);
    categoryCounts[record.category] += 1;
    if ((record.status === "IDENTITY_CONFIRMED") !== (record.publicationStatus === "PUBLISHED")) {
      throw new Error("Publication status contradicts admission status for " + record.id);
    }
    if (
      record.grossApy !== null ||
      record.netApy !== null ||
      record.riskAdjustedApy !== null ||
      record.riskScore !== null ||
      record.aumTvlUsd !== null ||
      record.liquidityUsd !== null ||
      record.observedAt !== null
    ) {
      throw new Error("Catalog metadata must not contain unsourced live metrics: " + record.id);
    }
    if (
      (record.category === "GOLD_BACKED_TOKEN" || record.category === "CASH_EQUIVALENT") &&
      record.nativeYield !== "0"
    ) {
      throw new Error("Native non-yield category must explicitly use zero: " + record.id);
    }
  }
  for (const [category, count] of Object.entries(categoryCounts)) {
    if (count === 0) {
      throw new Error("Catalog has no records for " + category);
    }
  }
  return {
    categoryCounts,
    gated: parsed.filter((record) => record.publicationStatus === "GATED").length,
    published: parsed.filter((record) => record.publicationStatus === "PUBLISHED").length,
    total: parsed.length,
    valid: true
  };
}

export const productionCatalog: ReadonlyArray<ProductionCatalogRecord> =
  normalizeDocument(catalogDocument);

const catalogBySlug = new Map(productionCatalog.map((record) => [record.slug, record]));

export function getCatalogRecordBySlug(slug: string): ProductionCatalogRecord | null {
  return catalogBySlug.get(slug) ?? null;
}

export interface PublishedCatalogImportRecord {
  readonly stableProductSlug: string;
  readonly stableRouteSlug: string;
  readonly productName: string;
  readonly symbol: string;
  readonly routeName: string;
  readonly category: ProductCategory;
  readonly chain: string;
  readonly issuer: string;
  readonly protocol: string | null;
  readonly underlyingAsset: string;
  readonly yieldSource: YieldSource;
  readonly accessMethod: string;
  readonly kycRequired: boolean | null;
  readonly eligibilitySummary: string;
  readonly redemptionSummary: string;
  readonly nativeYield: string | null;
  readonly source: ProductionCatalogRecord["source"];
  readonly confidence: Confidence;
  readonly verifiedAt: string;
}

export function createPublishedCatalogImportPayload(): ReadonlyArray<PublishedCatalogImportRecord> {
  return productionCatalog
    .filter((record) => record.publicationStatus === "PUBLISHED")
    .map((record) => ({
      accessMethod: record.accessMethod,
      category: record.category,
      chain: record.chain,
      confidence: record.confidence,
      eligibilitySummary: record.eligibilitySummary,
      issuer: record.issuer,
      kycRequired: record.kycRequired,
      nativeYield: record.nativeYield,
      productName: record.productName,
      protocol: record.protocol,
      redemptionSummary: record.redemptionSummary,
      routeName: record.routeName,
      source: record.source,
      stableProductSlug: record.slug.replace(
        /-(?:ethereum|polygon|solana|xrpl|mantle|arbitrum|base)$/u,
        ""
      ),
      stableRouteSlug: record.slug,
      symbol: record.symbol,
      underlyingAsset: record.underlyingAsset,
      verifiedAt: record.verifiedAt,
      yieldSource: record.yieldSource
    }));
}

validateProductionCatalog();

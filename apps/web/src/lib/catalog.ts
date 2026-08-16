import { productionCatalog } from "@rwa-yield-router/data-adapters";
import { z } from "zod";
import { CATEGORY_VALUES, type Category } from "@/lib/constants";

const nullableMetric = z.string().nullable();

export const PUBLIC_METRIC_STATUS_VALUES = [
  "CURRENT",
  "STALE",
  "ESTIMATED",
  "DEGRADED",
  "CONFLICTED",
  "UNKNOWN",
  "UNAVAILABLE",
  "AWAITING_VERIFICATION",
  "REJECTED"
] as const;

export type PublicMetricStatus = (typeof PUBLIC_METRIC_STATUS_VALUES)[number];

export interface CatalogMetricState {
  readonly status: PublicMetricStatus;
  readonly observedAt: string | null;
  readonly confidence: string;
}

export interface CatalogMetricStates {
  readonly yield: CatalogMetricState;
  readonly aumTvl: CatalogMetricState;
  readonly liquidity: CatalogMetricState;
  readonly risk: CatalogMetricState;
}

const catalogRecordSchema = z.object({
  accessMethod: z.string(),
  aumTvlUsd: nullableMetric,
  category: z.enum(CATEGORY_VALUES),
  chain: z.string(),
  confidence: z.string(),
  eligibilitySummary: z.string(),
  grossApy: nullableMetric,
  id: z.string(),
  issuer: z.string(),
  kycRequired: z.boolean().nullable(),
  liquidityUsd: nullableMetric,
  nativeYield: nullableMetric,
  netApy: nullableMetric,
  observedAt: z.string().nullable(),
  productName: z.string(),
  protocol: z.string().nullable(),
  publicationStatus: z.enum(["PUBLISHED", "GATED", "ARCHIVED"]),
  redemptionSummary: z.string(),
  riskAdjustedApy: nullableMetric,
  riskScore: nullableMetric,
  routeName: z.string(),
  slug: z.string(),
  source: z.object({
    name: z.string(),
    type: z.string(),
    url: z.url()
  }),
  status: z.string(),
  symbol: z.string(),
  underlyingAsset: z.string(),
  verifiedAt: z.string(),
  warnings: z.array(z.string()),
  yieldSource: z.string()
});

type BaseCatalogRecord = z.infer<typeof catalogRecordSchema>;

export type CatalogRecord = BaseCatalogRecord & {
  readonly identitySource: BaseCatalogRecord["source"];
  readonly lifecycleStatus:
    "ACTIVE" | "PAUSED" | "RESTRICTED" | "CLOSED" | "UNAVAILABLE" | "ARCHIVED";
  readonly methodologyVersion: string | null;
  readonly metricStatus: CatalogMetricStates;
  readonly productSlug: string;
  readonly sourceObservationIds: readonly string[];
};

const parsedCatalog = z.array(catalogRecordSchema).safeParse(productionCatalog);

if (!parsedCatalog.success) {
  throw new Error(`Production catalog failed validation: ${z.prettifyError(parsedCatalog.error)}`);
}

const unavailableMetricState = (confidence: string): CatalogMetricState => ({
  confidence,
  observedAt: null,
  status: "UNAVAILABLE"
});

const allRecords: CatalogRecord[] = parsedCatalog.data.map((record) => ({
  ...record,
  identitySource: record.source,
  lifecycleStatus: record.publicationStatus === "ARCHIVED" ? "ARCHIVED" : "ACTIVE",
  methodologyVersion: null,
  metricStatus: {
    aumTvl: unavailableMetricState(record.confidence),
    liquidity: unavailableMetricState(record.confidence),
    risk: unavailableMetricState(record.confidence),
    yield: unavailableMetricState(record.confidence)
  },
  productSlug: record.slug,
  sourceObservationIds: []
}));

/**
 * Public research catalog. Admission-gated records stay visible so coverage
 * limitations are explicit; they retain unavailable metrics and can never
 * enter the optimizer until separately admitted.
 */
export const getCatalog = (includeArchived = false): CatalogRecord[] =>
  allRecords.filter((record) => includeArchived || record.publicationStatus !== "ARCHIVED");

export const getAdmittedCatalog = (): CatalogRecord[] =>
  allRecords.filter((record) => record.publicationStatus === "PUBLISHED");

export const getCatalogRecord = (
  slug: string,
  includeArchived = false
): CatalogRecord | undefined => getCatalog(includeArchived).find((record) => record.slug === slug);

export const getCategoryRecords = (category: Category): CatalogRecord[] =>
  getCatalog().filter((record) => record.category === category);

export const getCatalogSources = (): CatalogRecord["source"][] => {
  const unique = new Map<string, CatalogRecord["source"]>();
  for (const record of allRecords) unique.set(record.source.url, record.source);
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export interface CatalogCategoryCoverage {
  readonly researched: number;
  readonly admitted: number;
  readonly gated: number;
}

const emptyCategoryCoverage = (): Record<Category, CatalogCategoryCoverage> => ({
  CASH_EQUIVALENT: { admitted: 0, gated: 0, researched: 0 },
  DEFI_LENDING: { admitted: 0, gated: 0, researched: 0 },
  GOLD_BACKED_TOKEN: { admitted: 0, gated: 0, researched: 0 },
  MONEY_MARKET_TOKEN: { admitted: 0, gated: 0, researched: 0 },
  STABLECOIN_VAULT: { admitted: 0, gated: 0, researched: 0 },
  TOKENIZED_TBILL: { admitted: 0, gated: 0, researched: 0 }
});

export const catalogStats = (input: readonly CatalogRecord[] = getCatalog()) => {
  const records = input.filter((record) => record.publicationStatus !== "ARCHIVED");
  const categoryCoverage = emptyCategoryCoverage();
  for (const record of records) {
    const current = categoryCoverage[record.category];
    categoryCoverage[record.category] = {
      admitted: current.admitted + (record.publicationStatus === "PUBLISHED" ? 1 : 0),
      gated: current.gated + (record.publicationStatus === "GATED" ? 1 : 0),
      researched: current.researched + 1
    };
  }
  const admitted = records.filter((record) => record.publicationStatus === "PUBLISHED").length;
  const gated = records.filter((record) => record.publicationStatus === "GATED").length;
  return {
    admitted,
    admittedCategories: CATEGORY_VALUES.filter(
      (category) => categoryCoverage[category].admitted > 0
    ).length,
    categoryCoverage,
    gated,
    products: new Set(records.map((record) => `${record.issuer}:${record.productName}`)).size,
    published: admitted,
    researched: records.length,
    researchedCategories: CATEGORY_VALUES.filter(
      (category) => categoryCoverage[category].researched > 0
    ).length,
    routes: records.length,
    sources: new Set(records.map((record) => record.source.url)).size
  };
};

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

export const catalogStats = () => {
  const records = getCatalog();
  return {
    gated: allRecords.filter((record) => record.publicationStatus === "GATED").length,
    products: new Set(records.map((record) => `${record.issuer}:${record.productName}`)).size,
    published: getAdmittedCatalog().length,
    researched: records.length,
    routes: records.length,
    sources: getCatalogSources().length
  };
};

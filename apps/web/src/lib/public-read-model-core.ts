import {
  RISK_FACTORS,
  riskMethodologySchema,
  type RiskMethodology
} from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { z } from "zod";
import {
  PUBLIC_METRIC_STATUS_VALUES,
  type CatalogMetricState,
  type CatalogRecord,
  type PublicMetricStatus
} from "@/lib/catalog";
import { CATEGORY_VALUES, type Category } from "@/lib/constants";

type PublicationStatus =
  "DRAFT" | "REVIEWED" | "PUBLISHED" | "REJECTED" | "ARCHIVED" | "SUPERSEDED";

const methodologyConfigurationSchema = z
  .object({
    maxAnnualPenaltyPp: z.string(),
    methodologyDocument: z.string().min(1),
    minimumEvidenceCoveragePct: z.string(),
    semanticVersion: z.string(),
    unknownRiskProxy: z.string()
  })
  .strict();

export interface DatabaseMethodologyRow {
  readonly calculationVersion: string;
  readonly configuration: unknown;
  readonly createdAt: Date;
  readonly description: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly id: string;
  readonly publicationStatus: PublicationStatus;
  readonly publishedAt: Date | null;
  readonly publishedByUserId: string | null;
  readonly reviewedByUserId: string | null;
  readonly version: string;
}

export interface DatabaseMethodologyWeightRow {
  readonly category: Category;
  readonly factorCode: string;
  /** Stored as a decimal ratio from zero through one. */
  readonly weight: string;
}

export interface EffectiveMethodology {
  readonly calculationVersion: string;
  readonly description: string;
  readonly methodology: RiskMethodology;
  readonly source: "DATABASE" | "STATIC_FALLBACK";
}

export interface MetricSelectionInput {
  readonly confidence: string;
  readonly freshnessThresholdSeconds: number;
  readonly hasValue: boolean;
  readonly observedAt: Date;
  readonly sourceStatus: "ACTIVE" | "DEGRADED" | "DISABLED" | "REMOVED";
  readonly status:
    | "AVAILABLE"
    | "UNKNOWN"
    | "UNAVAILABLE"
    | "STALE"
    | "ESTIMATED"
    | "CONFLICTED"
    | "RESTRICTED"
    | "AWAITING_VERIFICATION"
    | "REJECTED"
    | "DEGRADED";
}

const absentStatus = (
  status: MetricSelectionInput["status"]
): Extract<
  PublicMetricStatus,
  "UNKNOWN" | "UNAVAILABLE" | "AWAITING_VERIFICATION" | "REJECTED" | "CONFLICTED"
> => {
  switch (status) {
    case "UNKNOWN":
    case "UNAVAILABLE":
    case "AWAITING_VERIFICATION":
    case "REJECTED":
    case "CONFLICTED":
      return status;
    default:
      return "UNAVAILABLE";
  }
};

/**
 * Converts a selected persisted snapshot into a public state without erasing a
 * last valid value. Freshness is measured from the economic observation time.
 */
export function resolveMetricState(input: MetricSelectionInput, now: Date): CatalogMetricState {
  if (!input.hasValue) {
    return {
      confidence: input.confidence,
      observedAt: input.observedAt.toISOString(),
      status: absentStatus(input.status)
    };
  }

  if (input.sourceStatus === "DISABLED" || input.sourceStatus === "REMOVED") {
    return {
      confidence: "STALE",
      observedAt: input.observedAt.toISOString(),
      status: "STALE"
    };
  }

  const ageMs = now.getTime() - input.observedAt.getTime();
  if (ageMs < 0 || ageMs > input.freshnessThresholdSeconds * 1_000 || input.status === "STALE") {
    return {
      confidence: "STALE",
      observedAt: input.observedAt.toISOString(),
      status: "STALE"
    };
  }

  if (input.sourceStatus === "DEGRADED" || input.status === "DEGRADED") {
    return {
      confidence: input.confidence,
      observedAt: input.observedAt.toISOString(),
      status: "DEGRADED"
    };
  }

  const mappedStatus: PublicMetricStatus =
    input.status === "AVAILABLE"
      ? "CURRENT"
      : input.status === "ESTIMATED"
        ? "ESTIMATED"
        : absentStatus(input.status);
  return {
    confidence: input.confidence,
    observedAt: input.observedAt.toISOString(),
    status: mappedStatus
  };
}

export const metricStateHasDisplayValue = (state: CatalogMetricState): boolean =>
  state.status === "CURRENT" ||
  state.status === "STALE" ||
  state.status === "ESTIMATED" ||
  state.status === "DEGRADED";

/**
 * Database lifecycle always wins for previously admitted bundled records.
 * Gated research remains visible as research unless a valid database
 * publication replaces it; it is never promoted by the bundle alone.
 */
export function mergeCatalogPublication(
  bundled: readonly CatalogRecord[],
  publishedDatabaseRecords: readonly CatalogRecord[],
  databaseControlledSlugs: ReadonlySet<string>
): CatalogRecord[] {
  const publishedBySlug = new Map(publishedDatabaseRecords.map((record) => [record.slug, record]));
  const merged: CatalogRecord[] = [];

  for (const record of bundled) {
    const databaseRecord = publishedBySlug.get(record.slug);
    if (databaseRecord !== undefined) {
      merged.push(databaseRecord);
      publishedBySlug.delete(record.slug);
      continue;
    }
    if (databaseControlledSlugs.has(record.slug) && record.publicationStatus === "PUBLISHED") {
      continue;
    }
    merged.push(record);
  }

  merged.push(...publishedBySlug.values());
  return merged.sort((left, right) => left.slug.localeCompare(right.slug));
}

export function buildDatabaseMethodology(
  row: DatabaseMethodologyRow,
  weights: readonly DatabaseMethodologyWeightRow[]
): EffectiveMethodology {
  if (
    row.publicationStatus !== "PUBLISHED" ||
    row.publishedAt === null ||
    row.publishedByUserId === null ||
    row.reviewedByUserId === null ||
    row.effectiveTo !== null
  ) {
    throw new Error("The effective database methodology is not an immutable current publication");
  }

  const configuration = methodologyConfigurationSchema.parse(row.configuration);
  if (configuration.semanticVersion !== row.version) {
    throw new Error("The methodology semantic version does not match its database version");
  }

  const seen = new Set<string>();
  for (const weight of weights) {
    const key = `${weight.category}:${weight.factorCode}`;
    if (seen.has(key)) throw new Error(`Duplicate methodology weight ${key}`);
    seen.add(key);
  }
  const expectedWeightCount = CATEGORY_VALUES.length * RISK_FACTORS.length;
  if (seen.size !== expectedWeightCount) {
    throw new Error(`Methodology has ${seen.size} weights; expected ${expectedWeightCount}`);
  }

  const categoryWeights = Object.fromEntries(
    CATEGORY_VALUES.map((category) => [
      category,
      Object.fromEntries(
        RISK_FACTORS.map((factor) => {
          const weight = weights.find(
            (candidate) => candidate.category === category && candidate.factorCode === factor
          );
          if (weight === undefined)
            throw new Error(`Missing methodology weight ${category}:${factor}`);
          return [factor, new Decimal(weight.weight).mul(100).toString()];
        })
      )
    ])
  );

  const methodology = riskMethodologySchema.parse({
    authorId: `database-publisher:${row.publishedByUserId}`,
    categoryWeights,
    createdAt: row.createdAt.toISOString(),
    effectiveAt: row.effectiveFrom.toISOString(),
    id: row.id,
    maxAnnualPenaltyPp: configuration.maxAnnualPenaltyPp,
    minimumEvidenceCoveragePct: configuration.minimumEvidenceCoveragePct,
    publishedAt: row.publishedAt.toISOString(),
    releaseNotes: row.description,
    reviewerId: row.reviewedByUserId,
    semanticVersion: row.version,
    status: "PUBLISHED",
    unknownRiskProxy: configuration.unknownRiskProxy
  });

  return {
    calculationVersion: row.calculationVersion,
    description: row.description,
    methodology,
    source: "DATABASE"
  };
}

export function assertPublicMetricStatus(status: string): PublicMetricStatus {
  const parsed = z.enum(PUBLIC_METRIC_STATUS_VALUES).safeParse(status);
  if (!parsed.success) throw new Error(`Unsupported public metric status ${status}`);
  return parsed.data;
}

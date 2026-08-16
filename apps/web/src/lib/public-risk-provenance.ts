import { z } from "zod";

const compositeCalculationInputsSchema = z
  .object({
    factorSnapshotIds: z.array(z.string().uuid()).min(1),
    sourceObservationIds: z.array(z.string().uuid()).min(1)
  })
  .passthrough();

export interface CompositeRiskEvidenceInput {
  readonly calculatedAt: Date;
  readonly factorSnapshotIds: readonly string[];
  readonly methodologyVersionId: string;
  readonly sourceObservationIds: readonly string[];
}

export interface RiskFactorReference {
  readonly calculatedAt: Date;
  readonly factorCode: string;
  readonly id: string;
  readonly methodologyVersionId: string;
  readonly routeId: string | null;
}

export interface RiskEvidenceReference {
  readonly factorSnapshotId: string;
  readonly observedAt: Date;
  readonly sourceObservationId: string;
  readonly sourcePublicationStatus: string;
  readonly sourcePublishedAt: Date | null;
  readonly sourceStatus: string;
}

export function parseCompositeRiskEvidenceInput(
  raw: unknown,
  calculatedAt: Date,
  methodologyVersionId: string
): CompositeRiskEvidenceInput | null {
  const parsed = compositeCalculationInputsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const factorSnapshotIds = [...new Set(parsed.data.factorSnapshotIds)].sort();
  const sourceObservationIds = [...new Set(parsed.data.sourceObservationIds)].sort();
  if (
    factorSnapshotIds.length !== parsed.data.factorSnapshotIds.length ||
    sourceObservationIds.length !== parsed.data.sourceObservationIds.length
  )
    return null;
  return { calculatedAt, factorSnapshotIds, methodologyVersionId, sourceObservationIds };
}

export function validateCompositeRiskObservationIds(input: {
  readonly composite: CompositeRiskEvidenceInput;
  readonly evidence: readonly RiskEvidenceReference[];
  readonly factors: readonly RiskFactorReference[];
  readonly now: Date;
  readonly routeId: string;
}): string[] {
  const factorIds = new Set(input.composite.factorSnapshotIds);
  const matchingFactors = input.factors.filter((factor) => factorIds.has(factor.id));
  if (
    matchingFactors.length !== input.composite.factorSnapshotIds.length ||
    new Set(matchingFactors.map((factor) => factor.factorCode)).size !== matchingFactors.length ||
    matchingFactors.some(
      (factor) =>
        factor.routeId !== input.routeId ||
        factor.methodologyVersionId !== input.composite.methodologyVersionId ||
        factor.calculatedAt > input.composite.calculatedAt
    )
  )
    return [];

  const observedIds = [
    ...new Set(
      input.evidence.flatMap((evidence) =>
        factorIds.has(evidence.factorSnapshotId) &&
        evidence.observedAt <= input.composite.calculatedAt &&
        evidence.sourcePublicationStatus === "PUBLISHED" &&
        evidence.sourcePublishedAt !== null &&
        evidence.sourcePublishedAt <= input.now &&
        (evidence.sourceStatus === "ACTIVE" || evidence.sourceStatus === "DEGRADED")
          ? [evidence.sourceObservationId]
          : []
      )
    )
  ].sort();
  return observedIds.length === input.composite.sourceObservationIds.length &&
    observedIds.every(
      (observationId, index) => observationId === input.composite.sourceObservationIds[index]
    )
    ? observedIds
    : [];
}

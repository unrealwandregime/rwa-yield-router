import { describe, expect, it } from "vitest";
import {
  parseCompositeRiskEvidenceInput,
  validateCompositeRiskObservationIds
} from "./public-risk-provenance";

const ROUTE_ID = "10000000-0000-4000-8000-000000000001";
const METHOD_ID = "20000000-0000-4000-8000-000000000001";
const FACTOR_ID = "30000000-0000-4000-8000-000000000001";
const OBSERVATION_ID = "40000000-0000-4000-8000-000000000001";
const CALCULATED_AT = new Date("2026-07-18T12:00:00.000Z");

const composite = parseCompositeRiskEvidenceInput(
  { factorSnapshotIds: [FACTOR_ID], sourceObservationIds: [OBSERVATION_ID] },
  CALCULATED_AT,
  METHOD_ID
);

const factor = {
  calculatedAt: new Date("2026-07-18T11:55:00.000Z"),
  factorCode: "SMART_CONTRACT",
  id: FACTOR_ID,
  methodologyVersionId: METHOD_ID,
  routeId: ROUTE_ID
};
const factors = [factor];
const evidenceReference = {
  factorSnapshotId: FACTOR_ID,
  observedAt: new Date("2026-07-18T11:50:00.000Z"),
  sourceObservationId: OBSERVATION_ID,
  sourcePublicationStatus: "PUBLISHED",
  sourcePublishedAt: new Date("2026-07-01T00:00:00.000Z"),
  sourceStatus: "ACTIVE"
};
const evidence = [evidenceReference];

describe("public composite-risk provenance", () => {
  it("admits only the exact declared factor and observation graph", () => {
    expect(composite).not.toBeNull();
    if (composite === null) return;
    expect(
      validateCompositeRiskObservationIds({
        composite,
        evidence,
        factors,
        now: CALCULATED_AT,
        routeId: ROUTE_ID
      })
    ).toEqual([OBSERVATION_ID]);
  });

  it("fails closed for duplicate inputs, cross-route factors, or unpublished evidence", () => {
    expect(
      parseCompositeRiskEvidenceInput(
        {
          factorSnapshotIds: [FACTOR_ID, FACTOR_ID],
          sourceObservationIds: [OBSERVATION_ID]
        },
        CALCULATED_AT,
        METHOD_ID
      )
    ).toBeNull();
    expect(composite).not.toBeNull();
    if (composite === null) return;
    expect(
      validateCompositeRiskObservationIds({
        composite,
        evidence,
        factors: [{ ...factor, routeId: "50000000-0000-4000-8000-000000000001" }],
        now: CALCULATED_AT,
        routeId: ROUTE_ID
      })
    ).toEqual([]);
    expect(
      validateCompositeRiskObservationIds({
        composite,
        evidence: [{ ...evidenceReference, sourcePublicationStatus: "DRAFT" }],
        factors,
        now: CALCULATED_AT,
        routeId: ROUTE_ID
      })
    ).toEqual([]);
  });
});

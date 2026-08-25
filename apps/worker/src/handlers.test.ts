import { RISK_FACTORS, RISK_METHODOLOGY_V1 } from "@rwa-yield-router/risk-engine";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  buildCompositeRiskPersistence,
  classifyRiskEvidenceAtCutoff,
  normalizePersistedRiskFactor,
  observationPersistenceCounts,
  persistObservationAtomically,
  persistTriggeredAlertAtomically,
  parseSupportedPersistedRiskMethodology,
  ratioToPercentagePoints,
  resolveHistoryRollupWindow,
  selectEffectivePublishedRiskMethodology,
  type PersistedRiskEvidenceInput,
  type PersistedRiskMethodologyWeight,
  type PersistedRiskMethodologyVersion
} from "./handlers.js";

const PRODUCT_CATEGORIES = [
  "TOKENIZED_TBILL",
  "STABLECOIN_VAULT",
  "DEFI_LENDING",
  "MONEY_MARKET_TOKEN",
  "GOLD_BACKED_TOKEN",
  "CASH_EQUIVALENT"
] as const;

describe("worker observation normalization", () => {
  it("converts API decimal ratios to exact percentage points", () => {
    expect(ratioToPercentagePoints("0.043210000000000001")).toBe("4.3210000000000001");
    expect(ratioToPercentagePoints("0")).toBe("0");
    expect(ratioToPercentagePoints("1")).toBe("100");
  });

  it("commits an observation and typed snapshot atomically and repairs an orphan on retry", async () => {
    interface State {
      observation: boolean;
      typedSnapshot: boolean;
    }
    interface Transaction {
      state: State;
    }

    let committed: State = { observation: false, typedSnapshot: false };
    let rejectTypedSnapshot = true;
    const runInTransaction = async <TResult>(
      work: (transaction: Transaction) => Promise<TResult>
    ): Promise<TResult> => {
      const staged = { ...committed };
      const result = await work({ state: staged });
      committed = staged;
      return result;
    };
    const appendObservation = async (transaction: Transaction) => {
      const inserted = !transaction.state.observation;
      transaction.state.observation = true;
      return { inserted, observation: { id: "observation-1" } };
    };
    const persistTypedSnapshot = async (transaction: Transaction): Promise<boolean> => {
      if (rejectTypedSnapshot) throw new Error("typed snapshot write failed");
      const inserted = !transaction.state.typedSnapshot;
      transaction.state.typedSnapshot = true;
      return inserted;
    };

    await expect(
      persistObservationAtomically(runInTransaction, appendObservation, persistTypedSnapshot)
    ).rejects.toThrow(/typed snapshot write failed/u);
    expect(committed).toEqual({ observation: false, typedSnapshot: false });

    rejectTypedSnapshot = false;
    await expect(
      persistObservationAtomically(runInTransaction, appendObservation, persistTypedSnapshot)
    ).resolves.toMatchObject({ observationInserted: true, typedSnapshotInserted: true });
    expect(committed).toEqual({ observation: true, typedSnapshot: true });

    committed = { observation: true, typedSnapshot: false };
    await expect(
      persistObservationAtomically(runInTransaction, appendObservation, persistTypedSnapshot)
    ).resolves.toMatchObject({ observationInserted: false, typedSnapshotInserted: true });
    expect(committed).toEqual({ observation: true, typedSnapshot: true });
  });

  it("counts a duplicate stale observation as stale without claiming a changed record", () => {
    expect(
      observationPersistenceCounts("STALE", {
        observationInserted: false,
        typedSnapshotInserted: false
      })
    ).toEqual({ accepted: 1, changed: 0, stale: 1 });
  });
});

describe("worker alert persistence", () => {
  it("reconciles missing delivery rows for an existing event in one retry transaction", async () => {
    interface State {
      deliveries: Set<string>;
      eventExists: boolean;
      ruleEventId: string | null;
    }
    interface Transaction {
      state: State;
    }

    let committed: State = {
      deliveries: new Set(["destination-a"]),
      eventExists: true,
      ruleEventId: null
    };
    const runInTransaction = async <TResult>(
      work: (transaction: Transaction) => Promise<TResult>
    ): Promise<TResult> => {
      const staged: State = {
        deliveries: new Set(committed.deliveries),
        eventExists: committed.eventExists,
        ruleEventId: committed.ruleEventId
      };
      const result = await work({ state: staged });
      committed = staged;
      return result;
    };
    const event = { id: "event-1", triggeredAt: new Date("2026-07-18T10:00:00.000Z") };
    const operations = {
      async createOrLoadEvent(transaction: Transaction) {
        const inserted = !transaction.state.eventExists;
        transaction.state.eventExists = true;
        return { event, inserted };
      },
      async loadDestinations() {
        return [{ id: "destination-a" }, { id: "destination-b" }];
      },
      async persistDeliveries(
        transaction: Transaction,
        _event: typeof event,
        destinations: readonly { id: string }[]
      ) {
        let inserted = 0;
        for (const destination of destinations) {
          if (transaction.state.deliveries.has(destination.id)) continue;
          transaction.state.deliveries.add(destination.id);
          inserted += 1;
        }
        return inserted;
      },
      async persistRuleState(transaction: Transaction, persistedEvent: typeof event) {
        transaction.state.ruleEventId = persistedEvent.id;
      }
    };

    await expect(persistTriggeredAlertAtomically(runInTransaction, operations)).resolves.toEqual({
      changed: true,
      deliveriesInserted: 1,
      eventInserted: false
    });
    expect([...committed.deliveries].sort()).toEqual(["destination-a", "destination-b"]);
    expect(committed.ruleEventId).toBe("event-1");

    await expect(persistTriggeredAlertAtomically(runInTransaction, operations)).resolves.toEqual({
      changed: false,
      deliveriesInserted: 0,
      eventInserted: false
    });
    expect([...committed.deliveries].sort()).toEqual(["destination-a", "destination-b"]);
  });
});

describe("worker risk evidence admission", () => {
  const calculatedAt = new Date("2026-07-18T10:00:00.000Z");
  const currentEvidence = (
    overrides: Partial<PersistedRiskEvidenceInput> = {}
  ): PersistedRiskEvidenceInput => ({
    freshnessThresholdSeconds: 3_600,
    fetchedAt: new Date("2026-07-18T09:56:00.000Z"),
    observationId: "693b111c-9c86-4ca7-a1c4-49eaf90536c2",
    observationStatus: "AVAILABLE",
    observedAt: new Date("2026-07-18T09:55:00.000Z"),
    sourceArchivedAt: null,
    sourcePublicationStatus: "PUBLISHED",
    sourcePublishedAt: new Date("2026-07-01T00:00:00.000Z"),
    sourceStatus: "ACTIVE",
    verifiedAt: new Date("2026-07-18T09:57:00.000Z"),
    ...overrides
  });
  const factorInput = (evidence: readonly PersistedRiskEvidenceInput[]) => ({
    calculationCutoff: calculatedAt,
    calculationVersion: "risk-engine-v1.0.0",
    calculatedAt,
    confidence: "DIRECT_API" as const,
    evidence,
    explanation: "Sourced liquidity score.",
    factorCode: "LIQUIDITY",
    inputMetrics: { evidenceCoveragePct: "100", inputMetricIds: ["withdrawable-liquidity"] },
    resultStatus: "AVAILABLE" as const,
    score: "25"
  });

  it("publishes no composite score when every weighted factor lacks evidence", () => {
    const result = buildCompositeRiskPersistence("TOKENIZED_TBILL", calculatedAt, []);

    expect(result).toMatchObject({
      compositeScore: null,
      coverageRatio: "0",
      evidenceCoveragePct: "0.00",
      resultStatus: "UNAVAILABLE"
    });
    expect(result.explanation).toMatch(/no positively weighted factor/iu);
  });

  it("admits a factor only with explicit coverage and observation evidence", () => {
    const withoutEvidence = normalizePersistedRiskFactor(
      factorInput([]),
      "1.0.0",
      "risk-engine-v1.0.0"
    );
    expect(withoutEvidence).toMatchObject({
      admitted: false,
      result: { score: null, status: "UNAVAILABLE" }
    });

    const staleEvidence = normalizePersistedRiskFactor(
      {
        ...factorInput([currentEvidence({ observedAt: new Date("2026-07-18T08:59:59.999Z") })]),
        confidence: "STALE"
      },
      "1.0.0",
      "risk-engine-v1.0.0"
    );
    expect(staleEvidence).toMatchObject({
      admitted: false,
      result: { score: null, status: "UNAVAILABLE" }
    });

    const withEvidence = normalizePersistedRiskFactor(
      factorInput([currentEvidence()]),
      "1.0.0",
      "risk-engine-v1.0.0"
    );
    expect(withEvidence).toMatchObject({
      admitted: true,
      result: { score: "25", status: "AVAILABLE" }
    });
    if (withEvidence.result === null) throw new Error("Expected an admitted factor result");
    expect(
      buildCompositeRiskPersistence("TOKENIZED_TBILL", calculatedAt, [withEvidence.result])
    ).toMatchObject({
      compositeScore: expect.any(String),
      resultStatus: "PARTIAL"
    });
  });

  it("classifies source-policy freshness at the exact boundary and rejects future evidence", () => {
    expect(
      classifyRiskEvidenceAtCutoff(
        currentEvidence({ observedAt: new Date("2026-07-18T09:00:00.000Z") }),
        calculatedAt
      )
    ).toBe("CURRENT");
    expect(
      classifyRiskEvidenceAtCutoff(
        currentEvidence({ observedAt: new Date("2026-07-18T08:59:59.999Z") }),
        calculatedAt
      )
    ).toBe("STALE");
    expect(
      classifyRiskEvidenceAtCutoff(
        currentEvidence({ observedAt: new Date("2026-07-18T10:00:00.001Z") }),
        calculatedAt
      )
    ).toBe("INADMISSIBLE");
  });

  it("selects exactly one effective published methodology and rejects interval overlap", () => {
    const version = (
      id: string,
      effectiveFrom: string,
      effectiveTo: string | null = null
    ): PersistedRiskMethodologyVersion => ({
      calculationVersion: "risk-engine-v1.0.0",
      configuration: {},
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      description: "Test methodology",
      effectiveFrom: new Date(effectiveFrom),
      effectiveTo: effectiveTo === null ? null : new Date(effectiveTo),
      id,
      publicationStatus: "PUBLISHED",
      publishedAt: new Date("2026-07-02T00:00:00.000Z"),
      publishedByUserId: "70000000-0000-4000-8000-000000000001",
      reviewedAt: new Date("2026-07-01T12:00:00.000Z"),
      reviewedByUserId: "70000000-0000-4000-8000-000000000002",
      version: "1.0.0"
    });
    const current = version("80000000-0000-4000-8000-000000000001", "2026-07-13T00:00:00.000Z");
    expect(selectEffectivePublishedRiskMethodology([current], calculatedAt).id).toBe(current.id);
    expect(() =>
      selectEffectivePublishedRiskMethodology(
        [current, version("80000000-0000-4000-8000-000000000002", "2026-07-15T00:00:00.000Z")],
        calculatedAt
      )
    ).toThrow(/RISK_METHODOLOGY_INTERVAL_CONFLICT/u);
  });

  it("loads the supported relational methodology exactly and rejects incompatible engines", () => {
    const version: PersistedRiskMethodologyVersion = {
      calculationVersion: "risk-engine-v1.0.0",
      configuration: {
        maxAnnualPenaltyPp: "12",
        methodologyDocument: "RISK_METHODOLOGY.md",
        minimumEvidenceCoveragePct: "70",
        semanticVersion: "1.0.0",
        unknownRiskProxy: "75"
      },
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      description: "Published test methodology",
      effectiveFrom: new Date("2026-07-13T00:00:00.000Z"),
      effectiveTo: null,
      id: "80000000-0000-4000-8000-000000000003",
      publicationStatus: "PUBLISHED",
      publishedAt: new Date("2026-07-02T00:00:00.000Z"),
      publishedByUserId: "70000000-0000-4000-8000-000000000001",
      reviewedAt: new Date("2026-07-01T12:00:00.000Z"),
      reviewedByUserId: "70000000-0000-4000-8000-000000000002",
      version: "1.0.0"
    };
    const weights: PersistedRiskMethodologyWeight[] = PRODUCT_CATEGORIES.flatMap((category) =>
      RISK_FACTORS.map((factorCode) => ({
        category,
        factorCode,
        methodologyVersionId: version.id,
        missingEvidencePolicy: { mode: "UNKNOWN_RISK_PROXY" },
        penaltyConfiguration: { maxAnnualPenaltyPp: "12" },
        weight: new Decimal(RISK_METHODOLOGY_V1.categoryWeights[category][factorCode])
          .div(100)
          .toFixed(10)
      }))
    );
    expect(parseSupportedPersistedRiskMethodology(version, weights)).toMatchObject({
      categoryWeights: RISK_METHODOLOGY_V1.categoryWeights,
      semanticVersion: "1.0.0"
    });
    expect(() =>
      parseSupportedPersistedRiskMethodology(
        { ...version, calculationVersion: "risk-engine-v2.0.0" },
        weights
      )
    ).toThrow(/UNSUPPORTED_RISK_METHODOLOGY/u);

    const representativeWeight = weights.at(0);
    if (representativeWeight === undefined) throw new Error("Test methodology has no weights");
    const prototypeBefore = Object.getPrototypeOf({});
    expect(() =>
      parseSupportedPersistedRiskMethodology(version, [
        ...weights,
        {
          ...representativeWeight,
          factorCode: "__proto__"
        }
      ])
    ).toThrow(/UNSUPPORTED_RISK_METHODOLOGY/u);
    expect(Object.getPrototypeOf({})).toBe(prototypeBefore);
  });
});

describe("daily history rollup window", () => {
  it("uses only completed UTC days and a bounded history horizon", () => {
    const window = resolveHistoryRollupWindow(null, new Date("2026-07-18T18:45:00.000Z"));

    expect(window.cutoff.toISOString()).toBe("2026-07-18T18:45:00.000Z");
    expect(window.completedBefore.toISOString()).toBe("2026-07-18T00:00:00.000Z");
    expect(window.horizonStart.toISOString()).toBe(
      new Date(Date.parse("2026-07-18T00:00:00.000Z") - 366 * 24 * 60 * 60_000).toISOString()
    );
  });

  it("honors a fixed manual cutoff deterministically", () => {
    const first = resolveHistoryRollupWindow(
      "2026-07-10T12:00:00.000Z",
      new Date("2030-01-01T00:00:00.000Z")
    );
    const second = resolveHistoryRollupWindow(
      "2026-07-10T12:00:00.000Z",
      new Date("2040-01-01T00:00:00.000Z")
    );

    expect(first).toEqual(second);
    expect(first.completedBefore.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });
});

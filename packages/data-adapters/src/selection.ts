import type { NormalizedObservation, SourceType } from "./types.js";

const sourcePriority: Readonly<Record<SourceType, number>> = {
  OFFICIAL_API: 1,
  ONCHAIN: 2,
  OFFICIAL_DOCUMENT: 3,
  THIRD_PARTY_API: 4,
  MANUAL: 5
};

const confidencePriority: Readonly<Record<NormalizedObservation["confidence"], number>> = {
  VERIFIED_OFFICIAL: 1,
  DIRECT_API: 2,
  ONCHAIN_DERIVED: 2,
  ISSUER_REPORTED: 3,
  MANUALLY_VERIFIED: 3,
  THIRD_PARTY: 4,
  ESTIMATED: 5,
  STALE: 6,
  UNAVAILABLE: 7
};

export interface SelectionOptions {
  readonly now: Date;
  readonly staleAfterMs: number;
  readonly valuesEquivalent?: (left: string, right: string) => boolean;
}

export type SelectionResult =
  | Readonly<{
      status: "SELECTED";
      selected: NormalizedObservation;
      candidates: ReadonlyArray<NormalizedObservation>;
      fallbackUsed: boolean;
      policyVersion: "source-selection-v1";
    }>
  | Readonly<{
      status: "CONFLICTED";
      candidates: ReadonlyArray<NormalizedObservation>;
      conflictingSourceIds: ReadonlyArray<string>;
      policyVersion: "source-selection-v1";
    }>
  | Readonly<{
      status: "UNAVAILABLE";
      candidates: ReadonlyArray<NormalizedObservation>;
      reason: string;
      policyVersion: "source-selection-v1";
    }>;

function compareObservations(left: NormalizedObservation, right: NormalizedObservation): number {
  return (
    sourcePriority[left.source.type] - sourcePriority[right.source.type] ||
    confidencePriority[left.confidence] - confidencePriority[right.confidence] ||
    new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime() ||
    left.source.id.localeCompare(right.source.id) ||
    left.sourceRecordId?.localeCompare(right.sourceRecordId ?? "") ||
    0
  );
}

export function selectObservation(
  input: ReadonlyArray<NormalizedObservation>,
  options: SelectionOptions
): SelectionResult {
  if (input.length === 0) {
    return {
      candidates: [],
      policyVersion: "source-selection-v1",
      reason: "NO_CANDIDATES",
      status: "UNAVAILABLE"
    };
  }
  const [first] = input;
  if (first === undefined) {
    throw new Error("Unreachable empty candidate state");
  }
  const compatible = input.filter(
    (candidate) =>
      candidate.externalEntityId === first.externalEntityId &&
      candidate.metric === first.metric &&
      candidate.unit === first.unit &&
      candidate.status !== "REJECTED" &&
      new Date(candidate.observedAt).getTime() <= options.now.getTime() + 60_000 &&
      options.now.getTime() - new Date(candidate.observedAt).getTime() <= options.staleAfterMs
  );
  if (compatible.length === 0) {
    return {
      candidates: input,
      policyVersion: "source-selection-v1",
      reason: "NO_FRESH_COMPATIBLE_CANDIDATE",
      status: "UNAVAILABLE"
    };
  }
  const ranked = [...compatible].sort(compareObservations);
  const selected = ranked[0];
  if (selected === undefined) {
    throw new Error("Unreachable ranked candidate state");
  }
  const peers = ranked.filter(
    (candidate) =>
      sourcePriority[candidate.source.type] === sourcePriority[selected.source.type] &&
      confidencePriority[candidate.confidence] === confidencePriority[selected.confidence]
  );
  const equivalent = options.valuesEquivalent ?? ((left: string, right: string) => left === right);
  if (peers.some((candidate) => !equivalent(candidate.normalizedValue, selected.normalizedValue))) {
    return {
      candidates: ranked,
      conflictingSourceIds: peers.map((candidate) => candidate.source.id),
      policyVersion: "source-selection-v1",
      status: "CONFLICTED"
    };
  }
  const bestConfiguredPriority = Math.min(
    ...input.map((entry) => sourcePriority[entry.source.type])
  );
  return {
    candidates: ranked,
    fallbackUsed: sourcePriority[selected.source.type] > bestConfiguredPriority,
    policyVersion: "source-selection-v1",
    selected,
    status: "SELECTED"
  };
}

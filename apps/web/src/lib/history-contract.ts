import type { YieldHistoryPoint } from "@/lib/history";

export const serializeYieldHistoryPoint = (point: YieldHistoryPoint, routeSlug: string) => ({
  asOf: point.at,
  confidence: point.confidence,
  netApy: point.value,
  observation: point.observation,
  // Retained for v1 clients; `asOf` is the precise name for the selected snapshot timestamp.
  observedAt: point.at,
  rollup: point.rollup,
  routeSlug,
  snapshot: point.snapshot,
  source: point.source,
  status: point.status
});

export const latestHistorySourceTimestamp = (
  history: readonly YieldHistoryPoint[]
): string | null =>
  history
    .map((point) => point.observation.verifiedAt ?? point.observation.fetchedAt)
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

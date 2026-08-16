import { describe, expect, it } from "vitest";

import { classifyAdapterHealthOutcome } from "./database-job-store.js";

const result = (overrides: Partial<Parameters<typeof classifyAdapterHealthOutcome>[0]> = {}) => ({
  outcome: "SUCCEEDED" as const,
  recordsAccepted: 3,
  recordsChanged: 2,
  recordsRead: 3,
  recordsRejected: 0,
  staleRecords: 0,
  ...overrides
});

describe("adapter health classification", () => {
  it("reports a clean completed ingestion as succeeded", () => {
    expect(classifyAdapterHealthOutcome(result())).toBe("SUCCEEDED");
  });

  it("reports partial rejection or stale evidence as degraded", () => {
    expect(classifyAdapterHealthOutcome(result({ recordsRejected: 1 }))).toBe("DEGRADED");
    expect(classifyAdapterHealthOutcome(result({ staleRecords: 1 }))).toBe("DEGRADED");
  });
});

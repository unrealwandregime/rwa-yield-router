import { describe, expect, it } from "vitest";

import { workerJobSchema } from "./jobs.js";

describe("admin outbox job contract", () => {
  it("accepts a targeted source re-sync without carrying credentials", () => {
    const parsed = workerJobSchema.parse({
      correlationId: "e6e69843-d64b-493a-83c9-da40b02115de",
      externalEntityId: "1:0xbeef01735c132ada46aa9aa4c54623caa92a64cb",
      idempotencyKey: "admin-resync:steakhouse-usdc-ethereum:1",
      name: "INGEST_SOURCE",
      sourceId: "MORPHO-API",
      version: 1
    });

    expect(parsed.name).toBe("INGEST_SOURCE");
    expect(JSON.stringify(parsed)).not.toMatch(/token|secret|password/iu);
  });
});

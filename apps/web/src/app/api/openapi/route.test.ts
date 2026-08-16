import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("OpenAPI document", () => {
  it("documents historical yield and comparison resources", async () => {
    const response = GET();
    const document = (await response.json()) as {
      info: { version: string };
      paths: Record<string, unknown>;
    };

    expect(document.info.version).toBe("1.3.0");
    expect(document.paths).toHaveProperty("/api/v1/comparison");
    expect(document.paths).toHaveProperty("/api/v1/historical-yield");
    expect(document.paths).toHaveProperty("/api/v1/historical-yield/{slug}");
    expect(document.paths).toHaveProperty("/api/v1/simulations");
  });

  it("documents per-point source observation and snapshot provenance", async () => {
    const response = GET();
    const document = (await response.json()) as {
      components: { schemas: Record<string, unknown> };
      paths: Record<string, unknown>;
    };

    expect(document.components.schemas).toHaveProperty("HistoricalObservation");
    expect(document.components.schemas).toHaveProperty("HistoricalSnapshot");
    expect(document.components.schemas).toHaveProperty("HistoricalSource");
    expect(document.components.schemas).toHaveProperty("HistoricalYieldPoint");
    expect(JSON.stringify(document.paths["/api/v1/historical-yield"])).toContain(
      "HistoricalYieldPoint"
    );
  });

  it("publishes JSON schemas for every successful page and stable error envelope", async () => {
    const document = (await GET().json()) as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, { content?: Record<string, unknown> }> }>
      >;
    };
    for (const [path, operations] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        expect(
          operation.responses?.["200"]?.content?.["application/json"],
          `${method} ${path}`
        ).toBeDefined();
        for (const [status, response] of Object.entries(operation.responses ?? {})) {
          if (status === "200") continue;
          expect(
            response.content?.["application/json"],
            `${method} ${path} ${status}`
          ).toBeDefined();
        }
      }
    }
  });

  it("documents percentage-point history units and fail-closed simulation cost fields", async () => {
    const document = (await GET().json()) as {
      components: {
        schemas: Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
      };
      paths: Record<string, unknown>;
    };
    expect(JSON.stringify(document.components.schemas.HistoricalYieldPoint)).toContain(
      "percentage-point"
    );
    expect(JSON.stringify(document.components.schemas.HistoricalYieldPoint)).not.toContain(
      "Decimal-ratio"
    );
    expect(document.components.schemas.SimulationFeasible?.properties).toHaveProperty(
      "netBlendedApyBeforeTransactionCosts"
    );
    expect(document.components.schemas.SimulationFeasible?.properties).toHaveProperty(
      "transactionCostStatus"
    );
    expect(document.components.schemas.SimulationAllocation?.properties).toHaveProperty(
      "comparativeRiskAdjustedApyBeforeTransactionCosts"
    );
    expect(JSON.stringify(document.paths["/api/v1/simulations"])).toContain("SimulationRequest");
  });
});

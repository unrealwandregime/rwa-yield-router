import { once } from "node:events";
import type { AddressInfo } from "node:net";

import type { Logger, MetricPoint } from "@rwa-yield-router/observability";
import { afterEach, describe, expect, it } from "vitest";

import { createMetricsSnapshot, startHealthServer } from "./health.js";

const logger: Logger = {
  child: () => logger,
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined
};

const servers: Array<Awaited<ReturnType<typeof startHealthServer>>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.close();
      await once(server, "close");
    })
  );
});

async function start(options: Parameters<typeof startHealthServer>[0]) {
  const server = await startHealthServer(options);
  servers.push(server);
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("worker health server", () => {
  it("serves minimal liveness and bounded readiness responses", async () => {
    let ready = true;
    const baseUrl = await start({ logger, port: 0, ready: async () => ready });

    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "live" });
    expect(live.headers.get("cache-control")).toBe("no-store");

    ready = false;
    const unavailable = await fetch(`${baseUrl}/health/ready`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "not_ready" });
  });

  it("conceals private metrics unless the bearer token matches", async () => {
    const baseUrl = await start({
      logger,
      metrics: () => [
        {
          kind: "counter",
          labels: { job: "INGEST_SOURCE", subject: "user-123" },
          name: "worker_jobs_total",
          value: 2
        }
      ],
      metricsToken: "metrics-secret-1234",
      port: 0,
      ready: async () => true
    });

    expect((await fetch(`${baseUrl}/internal/metrics`)).status).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/internal/metrics`, {
          headers: { authorization: "Bearer wrong-token" }
        })
      ).status
    ).toBe(404);
    const response = await fetch(`${baseUrl}/internal/metrics`, {
      headers: { authorization: "Bearer metrics-secret-1234" }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      points: [
        {
          kind: "counter",
          labels: { job: "INGEST_SOURCE" },
          name: "worker_jobs_total",
          value: 2
        }
      ],
      status: "ok"
    });
  });
});

describe("metrics snapshot", () => {
  it("caps points and response size while dropping unsafe values", () => {
    const points: MetricPoint[] = Array.from({ length: 250 }, (_, index) => ({
      kind: "gauge",
      labels: { state: "ready", subject: `subject-${index}` },
      name: `queue_depth_${index}`,
      value: index
    }));
    points.push({ kind: "gauge", labels: {}, name: "bad name", value: 1 });

    const snapshot = createMetricsSnapshot(points);

    expect(snapshot.points).toHaveLength(200);
    expect(snapshot.points.every((point) => point.labels.subject === undefined)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(snapshot), "utf8")).toBeLessThanOrEqual(65_536);
  });
});

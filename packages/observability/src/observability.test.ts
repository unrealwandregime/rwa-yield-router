import { describe, expect, it } from "vitest";

import {
  createConfiguredErrorReporter,
  createInMemoryMetrics,
  createStructuredLogger,
  redactValue,
  REDACTED
} from "./index.js";

describe("redaction", () => {
  it("redacts nested credentials and personal identifiers", () => {
    expect(
      redactValue({
        authorization: "Bearer secret",
        nested: {
          email: "person@example.com",
          message: "contact person@example.com or 0x1111111111111111111111111111111111111111"
        }
      })
    ).toEqual({
      authorization: REDACTED,
      nested: {
        email: REDACTED,
        message: "contact [REDACTED] or [REDACTED]"
      }
    });
  });
});

describe("configured error reporter", () => {
  const now = () => new Date("2026-07-13T00:00:00.000Z");
  const eventId = () => "11111111-2222-3333-4444-555555555555";

  it("delivers a bounded redacted Sentry envelope without the DSN", async () => {
    const requests: Array<Readonly<{ body: string; init: RequestInit; url: string }>> = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push({
        body: String(init?.body ?? ""),
        init: init ?? {},
        url: String(input)
      });
      return new Response(null, { status: 202 });
    };
    const reporter = createConfiguredErrorReporter({
      environment: "test",
      eventId,
      now,
      sentryDsn: "https://public_key@errors.example.com/sentry/42",
      service: "worker",
      transport
    });

    await reporter.capture(
      new Error(
        "failed for person@example.com at http://10.0.0.4:8080 and 0x1111111111111111111111111111111111111111"
      ),
      { subject: "user-123", safeCode: "INGEST_FAILED", token: "top-secret" }
    );

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.url).toBe("https://errors.example.com/sentry/api/42/envelope/");
    expect(request?.init.credentials).toBe("omit");
    expect(request?.init.redirect).toBe("error");
    expect(new Headers(request?.init.headers).get("x-sentry-auth")).toContain(
      "sentry_key=public_key"
    );
    expect(request?.body).toContain("INGEST_FAILED");
    expect(request?.body).toContain(REDACTED);
    expect(request?.body).not.toContain("person@example.com");
    expect(request?.body).not.toContain("10.0.0.4");
    expect(request?.body).not.toContain("user-123");
    expect(request?.body).not.toContain("top-secret");
    expect(request?.body).not.toContain("public_key@");
    expect(Buffer.byteLength(request?.body ?? "", "utf8")).toBeLessThanOrEqual(24_576);
  });

  it("delivers OTLP JSON to the logs signal path", async () => {
    const requests: Array<Readonly<{ body: string; url: string }>> = [];
    const transport: typeof fetch = async (input, init) => {
      requests.push({ body: String(init?.body ?? ""), url: String(input) });
      return new Response(null, { status: 200 });
    };
    const reporter = createConfiguredErrorReporter({
      environment: "production",
      eventId,
      now,
      otlpEndpoint: "https://telemetry.example.com/otel",
      service: "rwa-yield-router-worker",
      transport
    });

    await reporter.capture(new Error("job failed"), { code: "JOB_FAILED" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://telemetry.example.com/otel/v1/logs");
    const payload = JSON.parse(requests[0]?.body ?? "{}") as {
      resourceLogs?: Array<{ scopeLogs?: Array<{ logRecords?: Array<{ body?: unknown }> }> }>;
    };
    expect(payload.resourceLogs?.[0]?.scopeLogs?.[0]?.logRecords?.[0]?.body).toEqual({
      stringValue: "job failed"
    });
  });

  it("writes bounded redacted capture events through the platform logger", async () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      environment: "production",
      now,
      service: "rwa-yield-router-worker",
      write: (line) => lines.push(line)
    });
    const reporter = createConfiguredErrorReporter({
      environment: "production",
      eventId,
      logger,
      mode: "platform",
      now,
      service: "rwa-yield-router-worker"
    });

    await reporter.capture(new Error("failed for person@example.com"), {
      code: "JOB_FAILED",
      token: "top-secret"
    });

    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record).toMatchObject({
      context: { code: "JOB_FAILED", token: REDACTED },
      environment: "production",
      errorMessage: "failed for [REDACTED]",
      errorType: "Error",
      event: "observability.error_captured",
      eventId: "11111111222233334444555555555555",
      occurredAt: "2026-07-13T00:00:00.000Z",
      reporter: "platform",
      service: "rwa-yield-router-worker",
      severity: "error"
    });
    expect(lines[0]).not.toContain("person@example.com");
    expect(lines[0]).not.toContain("top-secret");
  });

  it("fails closed when platform mode has no structured logger", () => {
    expect(() =>
      createConfiguredErrorReporter({
        environment: "production",
        mode: "platform",
        service: "worker"
      })
    ).toThrow(/structured logger/u);
  });

  it("ignores invalid destinations and transport failures", async () => {
    let calls = 0;
    const failingTransport: typeof fetch = async () => {
      calls += 1;
      throw new Error("network failed");
    };
    const invalid = createConfiguredErrorReporter({
      environment: "test",
      otlpEndpoint: "http://127.0.0.1:4318",
      sentryDsn: "https://public:secret@errors.example.com/1",
      service: "worker",
      transport: failingTransport
    });
    await expect(invalid.capture(new Error("ignored"))).resolves.toBeUndefined();
    expect(calls).toBe(0);

    const configured = createConfiguredErrorReporter({
      environment: "test",
      otlpEndpoint: "https://telemetry.example.com",
      service: "worker",
      transport: failingTransport
    });
    await expect(configured.capture(new Error("ignored"))).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe("structured logger", () => {
  it("writes deterministic redacted JSON records", () => {
    const lines: string[] = [];
    const logger = createStructuredLogger({
      environment: "test",
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      service: "worker",
      write: (line) => lines.push(line)
    });

    logger.info("job.completed", { token: "must-not-leak", records: 2 });

    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      environment: "test",
      event: "job.completed",
      records: 2,
      service: "worker",
      severity: "info",
      timestamp: "2026-07-13T00:00:00.000Z",
      token: REDACTED
    });
  });
});

describe("metrics", () => {
  it("aggregates counters and histograms by stable labels", () => {
    const metrics = createInMemoryMetrics();
    metrics.counter("jobs_total").add(1, { outcome: "ok" });
    metrics.counter("jobs_total").add(2, { outcome: "ok" });
    metrics.histogram("job_duration_ms").record(10);
    metrics.histogram("job_duration_ms").record(30);

    expect(metrics.snapshot()).toEqual([
      {
        count: 2,
        kind: "histogram",
        labels: {},
        name: "job_duration_ms",
        value: 40
      },
      {
        kind: "counter",
        labels: { outcome: "ok" },
        name: "jobs_total",
        value: 3
      }
    ]);
  });
});

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type {
  ErrorReporter,
  Logger,
  MetricLabels,
  MetricPoint
} from "@rwa-yield-router/observability";

const MAX_METRIC_POINTS = 200;
const MAX_METRICS_RESPONSE_BYTES = 65_536;
const SAFE_METRIC_NAME = /^[A-Za-z_:][A-Za-z0-9_.:-]{0,95}$/u;
const SAFE_METRIC_LABEL = /^[A-Za-z0-9_.:-]{1,64}$/u;
const ALLOWED_METRIC_LABELS = new Set([
  "job",
  "operation",
  "outcome",
  "provider",
  "queue",
  "state"
]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export interface HealthServerOptions {
  readonly port: number;
  readonly ready: () => Promise<boolean>;
  readonly logger: Logger;
  readonly metrics?: (() => ReadonlyArray<MetricPoint>) | undefined;
  readonly metricsToken?: string | undefined;
  readonly errorReporter?: ErrorReporter | undefined;
  readonly readinessTimeoutMs?: number | undefined;
}

function responseHeaders(contentLength: number): Readonly<Record<string, string>> {
  return {
    "cache-control": "no-store",
    "content-length": String(contentLength),
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff"
  };
}

function sendJson(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  value: unknown
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, responseHeaders(Buffer.byteLength(body, "utf8")));
  response.end(request.method === "HEAD" ? undefined : body);
}

function authorizedMetricsRequest(request: IncomingMessage, token: string | undefined): boolean {
  if (token === undefined) return LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? "");
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return false;
  const candidate = authorization.slice("Bearer ".length);
  const expectedBytes = Buffer.from(token);
  const candidateBytes = Buffer.from(candidate);
  return (
    expectedBytes.length === candidateBytes.length && timingSafeEqual(expectedBytes, candidateBytes)
  );
}

function sanitizeLabels(labels: MetricLabels): MetricLabels {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([key, value]) => ALLOWED_METRIC_LABELS.has(key) && SAFE_METRIC_LABEL.test(value))
      .slice(0, 6)
  );
}

function sanitizeMetricPoint(point: MetricPoint): MetricPoint | undefined {
  if (!SAFE_METRIC_NAME.test(point.name) || !Number.isFinite(point.value)) return undefined;
  if (
    point.kind === "histogram" &&
    (point.count === undefined || !Number.isSafeInteger(point.count) || point.count < 0)
  )
    return undefined;
  return {
    kind: point.kind,
    name: point.name,
    labels: sanitizeLabels(point.labels),
    value: point.value,
    ...(point.count === undefined ? {} : { count: point.count })
  };
}

export function createMetricsSnapshot(points: ReadonlyArray<MetricPoint>): Readonly<{
  points: ReadonlyArray<MetricPoint>;
  status: "ok";
}> {
  const sanitized = points
    .slice(0, MAX_METRIC_POINTS)
    .map(sanitizeMetricPoint)
    .filter((point): point is MetricPoint => point !== undefined);
  while (
    sanitized.length > 0 &&
    Buffer.byteLength(JSON.stringify({ points: sanitized, status: "ok" }), "utf8") >
      MAX_METRICS_RESPONSE_BYTES
  )
    sanitized.pop();
  return { points: sanitized, status: "ok" };
}

async function readiness(options: HealthServerOptions): Promise<boolean> {
  const timeoutMs = Math.min(Math.max(options.readinessTimeoutMs ?? 5_000, 250), 10_000);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      options.ready(),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
  } catch {
    void options.errorReporter?.capture(new Error("Worker readiness check failed"), {
      code: "READINESS_CHECK_FAILURE"
    });
    return false;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function startHealthServer(options: HealthServerOptions): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      sendJson(request, response, 405, { status: "method_not_allowed" });
      return;
    }
    const path = (request.url ?? "/").split("?", 1)[0];
    if (path === "/health/live") {
      sendJson(request, response, 200, { status: "live" });
      return;
    }
    if (path === "/health/ready") {
      void readiness(options).then((ready) => {
        sendJson(request, response, ready ? 200 : 503, {
          status: ready ? "ready" : "not_ready"
        });
      });
      return;
    }
    if (path === "/internal/metrics") {
      if (
        !authorizedMetricsRequest(request, options.metricsToken) ||
        options.metrics === undefined
      ) {
        sendJson(request, response, 404, { status: "not_found" });
        return;
      }
      try {
        sendJson(request, response, 200, createMetricsSnapshot(options.metrics()));
      } catch {
        void options.errorReporter?.capture(new Error("Worker metrics snapshot failed"), {
          code: "METRICS_SNAPSHOT_FAILURE"
        });
        sendJson(request, response, 503, { status: "unavailable" });
      }
      return;
    }
    sendJson(request, response, 404, { status: "not_found" });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "0.0.0.0", () => {
      server.off("error", reject);
      options.logger.info("health.started", { port: options.port });
      resolve(server);
    });
  });
}

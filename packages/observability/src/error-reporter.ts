import { randomUUID } from "node:crypto";

import type { LogContext } from "./logger.js";
import { redactValue } from "./redaction.js";

export interface ErrorReporter {
  capture(error: unknown, context?: LogContext): Promise<void>;
}

export interface ErrorReporterOptions {
  readonly environment: string;
  readonly service: string;
  readonly sentryDsn?: string | undefined;
  readonly otlpEndpoint?: string | undefined;
  readonly timeoutMs?: number;
  readonly transport?: typeof fetch;
  readonly now?: () => Date;
  readonly eventId?: () => string;
}

export function createNoopErrorReporter(): ErrorReporter {
  return {
    async capture() {
      return Promise.resolve();
    }
  };
}

const MAX_CONTEXT_BYTES = 8_192;
const MAX_EVENT_BYTES = 24_576;
const MAX_STRING_LENGTH = 512;
const MAX_COLLECTION_SIZE = 24;
const MAX_DEPTH = 5;

type JsonPrimitive = boolean | number | string | null;
interface JsonObject {
  readonly [key: string]: JsonValue;
}
type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;

interface SentryTarget {
  readonly endpoint: string;
  readonly publicKey: string;
}

function boundedString(value: string, limit = MAX_STRING_LENGTH): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 11))}[TRUNCATED]`;
}

function safeLabel(value: string): string {
  return boundedString(value.replace(/[^A-Za-z0-9_.:/-]/gu, "_"), 96);
}

function boundedJson(value: unknown, depth = 0): JsonValue {
  if (depth >= MAX_DEPTH) return "[MAX_DEPTH]";
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : "[NON_FINITE]";
  if (typeof value === "string") return boundedString(value);
  if (Array.isArray(value))
    return value.slice(0, MAX_COLLECTION_SIZE).map((entry) => boundedJson(entry, depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, MAX_COLLECTION_SIZE);
    return Object.fromEntries(
      entries.map(([key, entry]) => [boundedString(key, 64), boundedJson(entry, depth + 1)])
    );
  }
  return `[${typeof value}]`;
}

function safeContext(context: LogContext | undefined): JsonValue {
  const bounded = boundedJson(redactValue(context ?? {}));
  return Buffer.byteLength(JSON.stringify(bounded), "utf8") <= MAX_CONTEXT_BYTES
    ? bounded
    : { truncated: true };
}

function normalizeError(error: unknown): Readonly<{ message: string; type: string }> {
  if (error instanceof Error)
    return {
      message: boundedString(String(redactValue(error.message))),
      type: safeLabel(error.name || "Error")
    };
  if (typeof error === "string")
    return { message: boundedString(String(redactValue(error))), type: "Error" };
  return { message: "Non-error value thrown", type: "Error" };
}

function parseSentryDsn(value: string | undefined): SentryTarget | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username === "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return undefined;
    const publicKey = decodeURIComponent(url.username);
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(publicKey)) return undefined;
    const segments = url.pathname.split("/").filter(Boolean);
    const projectId = segments.pop();
    if (projectId === undefined || !/^[A-Za-z0-9_-]{1,64}$/u.test(projectId)) return undefined;
    const prefix = segments.length === 0 ? "" : `/${segments.join("/")}`;
    return {
      endpoint: `${url.origin}${prefix}/api/${projectId}/envelope/`,
      publicKey
    };
  } catch {
    return undefined;
  }
}

function parseOtlpEndpoint(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== ""
    )
      return undefined;
    const path = url.pathname.replace(/\/+$/u, "");
    url.pathname = path.endsWith("/v1/logs") ? path : `${path}/v1/logs`;
    return url.toString();
  } catch {
    return undefined;
  }
}

function eventIdentifier(value: string): string {
  const normalized = value.replaceAll("-", "").toLowerCase();
  return /^[a-f0-9]{32}$/u.test(normalized)
    ? normalized
    : randomUUID().replaceAll("-", "").toLowerCase();
}

function boundedPayload(payload: unknown): string | undefined {
  const serialized = JSON.stringify(payload);
  return Buffer.byteLength(serialized, "utf8") <= MAX_EVENT_BYTES ? serialized : undefined;
}

async function postPayload(
  transport: typeof fetch,
  endpoint: string,
  body: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await transport(endpoint, {
      body,
      credentials: "omit",
      headers,
      method: "POST",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    });
  } catch {
    // Telemetry delivery must never become an application failure path.
  } finally {
    clearTimeout(timeout);
  }
}

export function createConfiguredErrorReporter(options: ErrorReporterOptions): ErrorReporter {
  const sentry = parseSentryDsn(options.sentryDsn);
  const otlpEndpoint = parseOtlpEndpoint(options.otlpEndpoint);
  if (sentry === undefined && otlpEndpoint === undefined) return createNoopErrorReporter();

  const transport = options.transport ?? fetch;
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 3_000, 250), 10_000);
  const now = options.now ?? (() => new Date());
  const nextEventId = options.eventId ?? randomUUID;
  const service = safeLabel(options.service);
  const environment = safeLabel(options.environment);

  return {
    async capture(error, context) {
      try {
        const occurredAt = now();
        const eventId = eventIdentifier(nextEventId());
        const normalizedError = normalizeError(error);
        const normalizedContext = safeContext(context);
        const deliveries: Array<Promise<void>> = [];

        if (sentry !== undefined) {
          const event = boundedPayload({
            event_id: eventId,
            timestamp: occurredAt.toISOString(),
            platform: "node",
            level: "error",
            logger: service,
            environment,
            exception: {
              values: [{ type: normalizedError.type, value: normalizedError.message }]
            },
            extra: { context: normalizedContext },
            tags: { service }
          });
          if (event !== undefined) {
            const envelope = `${JSON.stringify({ event_id: eventId, sent_at: occurredAt.toISOString() })}\n${JSON.stringify({ type: "event" })}\n${event}`;
            if (Buffer.byteLength(envelope, "utf8") <= MAX_EVENT_BYTES)
              deliveries.push(
                postPayload(
                  transport,
                  sentry.endpoint,
                  envelope,
                  {
                    "content-type": "application/x-sentry-envelope",
                    "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${encodeURIComponent(sentry.publicKey)}`
                  },
                  timeoutMs
                )
              );
          }
        }

        if (otlpEndpoint !== undefined) {
          const contextJson = JSON.stringify(normalizedContext);
          const payload = boundedPayload({
            resourceLogs: [
              {
                resource: {
                  attributes: [
                    { key: "service.name", value: { stringValue: service } },
                    { key: "deployment.environment.name", value: { stringValue: environment } }
                  ]
                },
                scopeLogs: [
                  {
                    scope: { name: "@rwa-yield-router/observability" },
                    logRecords: [
                      {
                        timeUnixNano: String(BigInt(occurredAt.getTime()) * 1_000_000n),
                        observedTimeUnixNano: String(BigInt(occurredAt.getTime()) * 1_000_000n),
                        severityNumber: 17,
                        severityText: "ERROR",
                        body: { stringValue: normalizedError.message },
                        attributes: [
                          { key: "error.type", value: { stringValue: normalizedError.type } },
                          { key: "event.id", value: { stringValue: eventId } },
                          { key: "error.context", value: { stringValue: contextJson } }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          });
          if (payload !== undefined)
            deliveries.push(
              postPayload(
                transport,
                otlpEndpoint,
                payload,
                { "content-type": "application/json" },
                timeoutMs
              )
            );
        }

        await Promise.allSettled(deliveries);
      } catch {
        // Error capture is best-effort and may not throw into application code.
      }
    }
  };
}

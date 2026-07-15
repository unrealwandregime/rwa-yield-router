import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { apiError, checkRateLimit, requestIdentity, validateBrowserMutation } from "@/lib/api";
import { webVitalPayloadSchema, type WebVitalPayload } from "@/lib/web-vitals";

const MAX_REQUEST_BYTES = 2_048;

async function readBoundedJson(request: NextRequest): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_REQUEST_BYTES)
      throw new Error("Request body is outside the permitted size");
  }
  if (request.body === null) throw new Error("Request body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error("Request body is outside the permitted size");
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
}

export function createWebVitalLogRecord(
  metric: WebVitalPayload,
  correlationId: string,
  observedAt = new Date()
): Readonly<Record<string, unknown>> {
  return {
    timestamp: observedAt.toISOString(),
    severity: "info",
    service: "rwa-yield-router-web",
    environment: process.env.NODE_ENV ?? "development",
    event: "web_vital.observed",
    correlationId,
    metric
  };
}

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!validateBrowserMutation(request.url, request.headers))
    return apiError(
      403,
      "AUTHORIZATION_DENIED",
      "Browser mutation validation failed.",
      correlationId
    );
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
    return apiError(
      415,
      "VALIDATION_ERROR",
      "Content type must be application/json.",
      correlationId
    );
  if (
    !(await checkRateLimit(`web-vitals:${requestIdentity(request.headers)}`, 120, 60_000)).allowed
  )
    return apiError(429, "RATE_LIMITED", "Web-vitals rate limit exceeded.", correlationId);

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Web-vitals payload is invalid.", correlationId);
  }
  const parsed = webVitalPayloadSchema.safeParse(body);
  if (!parsed.success)
    return apiError(400, "VALIDATION_ERROR", "Web-vitals payload is invalid.", correlationId);

  process.stdout.write(`${JSON.stringify(createWebVitalLogRecord(parsed.data, correlationId))}\n`);
  return NextResponse.json(
    { accepted: true },
    {
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "x-correlation-id": correlationId
      },
      status: 202
    }
  );
}

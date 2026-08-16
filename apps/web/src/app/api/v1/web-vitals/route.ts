import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  apiError,
  checkRateLimit,
  JsonBodyError,
  readBoundedJson,
  requestIdentity,
  validateBrowserMutation
} from "@/lib/api";
import { createWebVitalLogRecord, webVitalPayloadSchema } from "@/lib/web-vitals";

const MAX_REQUEST_BYTES = 2_048;

export async function POST(request: NextRequest) {
  const correlationId = randomUUID();
  if (!validateBrowserMutation(request.url, request.headers))
    return apiError(
      403,
      "AUTHORIZATION_DENIED",
      "Browser mutation validation failed.",
      correlationId
    );
  if (
    !(await checkRateLimit(`web-vitals:${requestIdentity(request.headers)}`, 120, 60_000)).allowed
  )
    return apiError(429, "RATE_LIMITED", "Web-vitals rate limit exceeded.", correlationId);

  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    const status = error instanceof JsonBodyError ? error.status : 400;
    return apiError(status, "VALIDATION_ERROR", "Web-vitals payload is invalid.", correlationId);
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

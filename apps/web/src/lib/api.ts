import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getServerConfig } from "@rwa-yield-router/config";
import Redis from "ioredis";
import { NextResponse } from "next/server";
import { z } from "zod";

export const paginationSchema = z.object({
  cursor: z.string().max(24).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export type ApiErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "AUTHORIZATION_DENIED"
  | "CONFIGURATION_UNAVAILABLE"
  | "INTERNAL_ERROR"
  | "MFA_REQUIRED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "RECENT_AUTH_REQUIRED"
  | "VALIDATION_ERROR";

export type JsonBodyErrorCode =
  "INVALID_JSON" | "MISSING_BODY" | "REQUEST_TOO_LARGE" | "UNSUPPORTED_CONTENT_TYPE";

export const DEFAULT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

export class JsonBodyError extends Error {
  readonly code: JsonBodyErrorCode;
  readonly status: 400 | 413 | 415;

  constructor(code: JsonBodyErrorCode, status: 400 | 413 | 415) {
    super(code);
    this.name = "JsonBodyError";
    this.code = code;
    this.status = status;
  }
}

export async function readBoundedJson(
  request: Readonly<Pick<Request, "body" | "headers">>,
  maxBytes: number
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new RangeError("JSON request limit must be a positive safe integer");
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
    throw new JsonBodyError("UNSUPPORTED_CONTENT_TYPE", 415);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0)
      throw new JsonBodyError("INVALID_JSON", 400);
    if (parsedLength > maxBytes) throw new JsonBodyError("REQUEST_TOO_LARGE", 413);
  }
  if (request.body === null) throw new JsonBodyError("MISSING_BODY", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new JsonBodyError("REQUEST_TOO_LARGE", 413);
    }
    chunks.push(result.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new JsonBodyError("INVALID_JSON", 400);
  }
}

export const apiError = (
  status: number,
  code: ApiErrorCode,
  message: string,
  correlationId = randomUUID(),
  details?: unknown
) =>
  NextResponse.json(
    { error: { code, correlationId, ...(details === undefined ? {} : { details }), message } },
    { headers: { "cache-control": "no-store", "x-correlation-id": correlationId }, status }
  );

export const encodeCursor = (offset: number): string =>
  Buffer.from(String(offset)).toString("base64url");

export const decodeCursor = (cursor: string | undefined): number => {
  if (!cursor) return 0;
  try {
    const parsed = Number(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

export const jsonWithEtag = (body: unknown, init?: { cacheSeconds?: number; status?: number }) => {
  const serialized = JSON.stringify(body);
  const etag = `"${createHash("sha256").update(serialized).digest("base64url")}"`;
  return new NextResponse(serialized, {
    headers: {
      "cache-control": `public, max-age=0, s-maxage=${init?.cacheSeconds ?? 60}, stale-while-revalidate=300`,
      "content-type": "application/json; charset=utf-8",
      etag
    },
    status: init?.status ?? 200
  });
};

type RateEntry = { count: number; resetAt: number };
const rateEntries = new Map<string, RateEntry>();
let redisRateClient: Promise<Redis> | undefined;
let rateLimitStoreHealthCache: Readonly<{ expiresAt: number; healthy: boolean }> | undefined;
let rateLimitStoreHealthInFlight: Promise<boolean> | undefined;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
local ttl = redis.call("PTTL", KEYS[1])
return {count, ttl}
`;

const getRedisRateClient = async (): Promise<Redis> => {
  const { nodeEnv, redisUrl } = getServerConfig();
  if (!redisUrl) throw new Error("REDIS_URL is not configured");
  const parsed = new URL(redisUrl);
  if (
    (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") ||
    (nodeEnv === "production" && parsed.protocol !== "rediss:")
  )
    throw new Error("REDIS_URL protocol is not permitted");
  redisRateClient ??= (async () => {
    const client = new Redis(redisUrl, {
      commandTimeout: 2_000,
      connectTimeout: 2_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
    client.on("error", () => undefined);
    await client.connect();
    return client;
  })().catch((error: unknown) => {
    redisRateClient = undefined;
    throw error;
  });
  return redisRateClient;
};

export const checkRateLimitStoreHealth = async (): Promise<boolean> => {
  const config = getServerConfig();
  if (!config.redisUrl)
    return config.nodeEnv !== "production" || config.deploymentTier === "preview";
  const now = Date.now();
  if (rateLimitStoreHealthCache && rateLimitStoreHealthCache.expiresAt > now)
    return rateLimitStoreHealthCache.healthy;
  rateLimitStoreHealthInFlight ??= (async () => {
    try {
      return (await (await getRedisRateClient()).ping()) === "PONG";
    } catch {
      return false;
    }
  })().finally(() => {
    rateLimitStoreHealthInFlight = undefined;
  });
  const healthy = await rateLimitStoreHealthInFlight;
  rateLimitStoreHealthCache = { expiresAt: now + (healthy ? 10_000 : 5_000), healthy };
  return healthy;
};

const checkInMemoryRateLimit = (key: string, limit: number, windowMs: number) => {
  const now = Date.now();
  const current = rateEntries.get(key);
  if (!current || current.resetAt <= now) {
    if (rateEntries.size > 5_000) {
      for (const [entryKey, entry] of rateEntries)
        if (entry.resetAt <= now) rateEntries.delete(entryKey);
    }
    const next = { count: 1, resetAt: now + windowMs };
    rateEntries.set(key, next);
    return { allowed: true, remaining: limit - 1, resetAt: next.resetAt };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    remaining: Math.max(0, limit - current.count),
    resetAt: current.resetAt
  };
};

export const checkRateLimit = async (key: string, limit: number, windowMs: number) => {
  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    !Number.isSafeInteger(windowMs) ||
    windowMs <= 0
  )
    throw new RangeError("Rate-limit bounds must be positive integers");
  const config = getServerConfig();
  const now = Date.now();
  if (config.redisUrl) {
    try {
      const client = await getRedisRateClient();
      const redisKey = `rwa:rate:${createHash("sha256").update(key).digest("base64url")}`;
      const result: unknown = await client.eval(RATE_LIMIT_SCRIPT, 1, redisKey, windowMs);
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        typeof result[0] !== "number" ||
        typeof result[1] !== "number"
      )
        throw new Error("Redis rate-limit response was malformed");
      return {
        allowed: result[0] <= limit,
        remaining: Math.max(0, limit - result[0]),
        resetAt: now + Math.max(0, result[1])
      };
    } catch {
      if (config.nodeEnv === "production" && config.deploymentTier === "production")
        return { allowed: false, remaining: 0, resetAt: now + windowMs };
    }
  }
  if (config.nodeEnv === "production" && config.deploymentTier === "production")
    return { allowed: false, remaining: 0, resetAt: now + windowMs };
  return checkInMemoryRateLimit(key, limit, windowMs);
};

export const requestIdentity = (headers: Headers): string => {
  const config = getServerConfig();
  const forwardedAddress = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  const address =
    config.trustedProxyMode === "render" &&
    forwardedAddress !== undefined &&
    isIP(forwardedAddress) !== 0
      ? forwardedAddress
      : "unknown";
  return createHash("sha256").update(address).digest("base64url");
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

const sameOriginOrLoopbackEquivalent = (left: URL, right: URL): boolean =>
  left.origin === right.origin ||
  (left.protocol === right.protocol &&
    left.port === right.port &&
    LOOPBACK_HOSTS.has(left.hostname) &&
    LOOPBACK_HOSTS.has(right.hostname));

export const validateOrigin = (requestUrl: string, headers: Headers): boolean => {
  const fetchSite = headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  const origin = headers.get("origin");
  const referer = headers.get("referer");
  try {
    const expectedOrigin = new URL(requestUrl);
    if (origin !== null) return sameOriginOrLoopbackEquivalent(new URL(origin), expectedOrigin);
    if (referer !== null) return sameOriginOrLoopbackEquivalent(new URL(referer), expectedOrigin);
    return false;
  } catch {
    return false;
  }
};

const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

const cookieValue = (cookieHeader: string | null, name: string): string | null => {
  if (cookieHeader === null) return null;
  for (const segment of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = segment.trim().split("=");
    if (rawName === name) return rawValue.join("=");
  }
  return null;
};

export const validateCsrfToken = (requestUrl: string, headers: Headers): boolean => {
  let secure: boolean;
  try {
    secure = new URL(requestUrl).protocol === "https:";
  } catch {
    return false;
  }
  const name = secure ? "__Host-rwa-csrf" : "rwa-csrf";
  const cookieToken = cookieValue(headers.get("cookie"), name);
  const headerToken = headers.get("x-rwa-csrf-token");
  if (
    cookieToken === null ||
    headerToken === null ||
    !CSRF_TOKEN_PATTERN.test(cookieToken) ||
    !CSRF_TOKEN_PATTERN.test(headerToken)
  )
    return false;
  return timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
};

export const resolveApplicationUrl = (requestUrl: string): string => {
  const config = getServerConfig();
  try {
    const parsedRequestUrl = new URL(requestUrl);
    if (LOOPBACK_HOSTS.has(parsedRequestUrl.hostname)) return requestUrl;
  } catch {
    return requestUrl;
  }
  return config.nodeEnv === "production" ? config.appUrl : requestUrl;
};

export const validateBrowserMutation = (requestUrl: string, headers: Headers): boolean => {
  const validationUrl = resolveApplicationUrl(requestUrl);
  return validateOrigin(validationUrl, headers) && validateCsrfToken(validationUrl, headers);
};

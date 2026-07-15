import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import type { z } from "zod";

import { AdapterError } from "./errors.js";
import type { RequestRateLimiter } from "./rate-limit.js";

export interface ResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type HostResolver = (hostname: string) => Promise<ReadonlyArray<ResolvedAddress>>;

export interface SafeFetchPolicy {
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedPorts?: ReadonlySet<number> | undefined;
  readonly allowedContentTypes: ReadonlySet<string>;
  readonly maxResponseBytes: number;
  readonly maxCompressionRatio?: number | undefined;
  readonly maxRedirects?: number | undefined;
  readonly timeoutMs: number;
  readonly resolver?: HostResolver | undefined;
  readonly fetchImplementation?: typeof fetch | undefined;
  readonly rateLimiter?: RequestRateLimiter | undefined;
}

export interface SafeFetchJsonOptions<TSchema extends z.ZodType> {
  readonly url: string;
  readonly init?: Readonly<Omit<RequestInit, "redirect" | "signal">> | undefined;
  readonly policy: SafeFetchPolicy;
  readonly schema: TSchema;
  readonly signal?: AbortSignal | undefined;
}

function parseIpv4(address: string): ReadonlyArray<number> | null {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = parts.map((part) => Number(part));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isUnsafeIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (octets === null) {
    return true;
  }
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 0 && octets[2] === 2) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function isUnsafeIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%", 1)[0] ?? "";
  if (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  ) {
    return true;
  }
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/u)?.[1];
  return mappedIpv4 !== undefined && isUnsafeIpv4(mappedIpv4);
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return !isUnsafeIpv4(address);
  }
  if (family === 6) {
    return !isUnsafeIpv6(address);
  }
  return false;
}

const defaultResolver: HostResolver = async (hostname) => {
  const result = await lookup(hostname, { all: true, verbatim: true });
  return result.map((entry) => ({
    address: entry.address,
    family: entry.family === 4 ? 4 : 6
  }));
};

function validateUrl(rawUrl: string, policy: SafeFetchPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AdapterError("INVALID_URL", { retryable: false });
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    isIP(url.hostname) !== 0
  ) {
    throw new AdapterError("INVALID_URL", { retryable: false });
  }
  const hostname = url.hostname.toLowerCase();
  if (!policy.allowedHosts.has(hostname)) {
    throw new AdapterError("HOST_NOT_ALLOWED", { retryable: false });
  }
  const port = url.port === "" ? 443 : Number(url.port);
  if (
    !Number.isInteger(port) ||
    (policy.allowedPorts === undefined ? port !== 443 : !policy.allowedPorts.has(port))
  ) {
    throw new AdapterError("INVALID_URL", { retryable: false });
  }
  return url;
}

async function validateDestination(url: URL, policy: SafeFetchPolicy): Promise<void> {
  try {
    const addresses = await (policy.resolver ?? defaultResolver)(url.hostname);
    if (
      addresses.length === 0 ||
      addresses.some((entry) => !isPublicNetworkAddress(entry.address))
    ) {
      throw new AdapterError("UNSAFE_DESTINATION", { retryable: false });
    }
  } catch (error) {
    if (error instanceof AdapterError) {
      throw error;
    }
    throw new AdapterError("DNS_LOOKUP_FAILED", { retryable: true });
  }
}

function matchesContentType(contentType: string, allowed: ReadonlySet<string>): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return allowed.has(mediaType);
}

async function readBoundedResponse(response: Response, policy: SafeFetchPolicy): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      throw new AdapterError("MALFORMED_RESPONSE", { retryable: true });
    }
    if (parsedLength > policy.maxResponseBytes) {
      throw new AdapterError("RESPONSE_TOO_LARGE", { retryable: false });
    }
  }
  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    totalBytes += result.value.byteLength;
    if (totalBytes > policy.maxResponseBytes) {
      await reader.cancel();
      throw new AdapterError("RESPONSE_TOO_LARGE", { retryable: false });
    }
    chunks.push(result.value);
  }
  if (
    response.headers.has("content-encoding") &&
    declaredLength !== null &&
    Number(declaredLength) > 0 &&
    totalBytes / Number(declaredLength) > (policy.maxCompressionRatio ?? 20)
  ) {
    throw new AdapterError("RESPONSE_TOO_LARGE", { retryable: false });
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function mergeSignals(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined) {
    return () => undefined;
  }
  if (signal.aborted) {
    controller.abort();
    return () => undefined;
  }
  const abort = (): void => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  return () => signal.removeEventListener("abort", abort);
}

export async function safeFetchJson<TSchema extends z.ZodType>(
  options: SafeFetchJsonOptions<TSchema>
): Promise<z.infer<TSchema>> {
  if (
    !Number.isInteger(options.policy.maxResponseBytes) ||
    options.policy.maxResponseBytes <= 0 ||
    !Number.isInteger(options.policy.timeoutMs) ||
    options.policy.timeoutMs <= 0
  ) {
    throw new RangeError("Safe fetch byte and time limits must be positive integers");
  }

  const fetchImplementation = options.policy.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const removeAbortListener = mergeSignals(options.signal, controller);
  const timeout = setTimeout(() => controller.abort(), options.policy.timeoutMs);
  let currentUrl = validateUrl(options.url, options.policy);
  const maxRedirects = options.policy.maxRedirects ?? 0;

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      await validateDestination(currentUrl, options.policy);
      const rateLimit = options.policy.rateLimiter?.acquire(currentUrl.hostname);
      if (rateLimit !== undefined && !rateLimit.allowed) {
        throw new AdapterError("RATE_LIMITED", { retryable: true, status: 429 });
      }

      let response: Response;
      try {
        response = await fetchImplementation(currentUrl, {
          ...options.init,
          redirect: "manual",
          signal: controller.signal
        });
      } catch {
        throw new AdapterError(controller.signal.aborted ? "TIMEOUT" : "NETWORK_FAILURE", {
          retryable: true
        });
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location === null || redirectCount >= maxRedirects) {
          throw new AdapterError("REDIRECT_BLOCKED", {
            retryable: false,
            status: response.status
          });
        }
        currentUrl = validateUrl(new URL(location, currentUrl).toString(), options.policy);
        continue;
      }
      if (!response.ok) {
        throw new AdapterError("UPSTREAM_REJECTED", {
          retryable: response.status === 429 || response.status >= 500,
          status: response.status
        });
      }
      const contentType = response.headers.get("content-type");
      if (
        contentType === null ||
        !matchesContentType(contentType, options.policy.allowedContentTypes)
      ) {
        throw new AdapterError("UNSUPPORTED_CONTENT_TYPE", {
          retryable: false,
          status: response.status
        });
      }
      const text = await readBoundedResponse(response, options.policy);
      let untrusted: unknown;
      try {
        untrusted = JSON.parse(text);
      } catch {
        throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
      }
      const parsed = options.schema.safeParse(untrusted);
      if (!parsed.success) {
        throw new AdapterError("MALFORMED_RESPONSE", { retryable: false });
      }
      return parsed.data;
    }
  } finally {
    clearTimeout(timeout);
    removeAbortListener();
  }
}

import { z } from "zod";

const MAX_RESPONSE_BYTES = 64 * 1024;

export interface JsonRequestOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly fetchImplementation?: typeof fetch | undefined;
}

export type JsonRequestResult =
  | Readonly<{ ok: true; status: number; body: unknown }>
  | Readonly<{
      ok: false;
      status: number | null;
      retryable: boolean;
      retryAfterSeconds: number | null;
      code: string;
    }>;

const jsonContentTypeSchema = z
  .string()
  .refine((value) => /^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|$)/iu.test(value));

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d{1,6}$/u.test(value)) {
    return null;
  }
  return Math.min(Number.parseInt(value, 10), 86_400);
}

async function readBoundedBody(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new Error("RESPONSE_TOO_LARGE");
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
    if (totalBytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("RESPONSE_TOO_LARGE");
    }
    chunks.push(result.value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function postJson(options: JsonRequestOptions): Promise<JsonRequestResult> {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);

  try {
    const response = await fetchImplementation(options.url, {
      body: JSON.stringify(options.body),
      headers: options.headers,
      method: "POST",
      redirect: "error",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type");
    if (contentType === null || !jsonContentTypeSchema.safeParse(contentType).success) {
      return {
        code: "UNEXPECTED_CONTENT_TYPE",
        ok: false,
        retryAfterSeconds: null,
        retryable: response.status >= 500,
        status: response.status
      };
    }
    const text = await readBoundedBody(response);
    const body: unknown = text === "" ? null : JSON.parse(text);
    if (!response.ok) {
      return {
        code: "PROVIDER_REJECTED",
        ok: false,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
        retryable: response.status === 429 || response.status >= 500,
        status: response.status
      };
    }
    return { body, ok: true, status: response.status };
  } catch (error) {
    const code =
      error instanceof Error && error.message === "RESPONSE_TOO_LARGE"
        ? "RESPONSE_TOO_LARGE"
        : controller.signal.aborted
          ? "TIMEOUT"
          : "NETWORK_FAILURE";
    return {
      code,
      ok: false,
      retryAfterSeconds: null,
      retryable: true,
      status: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

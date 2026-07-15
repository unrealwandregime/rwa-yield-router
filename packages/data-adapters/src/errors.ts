export type AdapterErrorCode =
  | "ABORTED"
  | "DNS_LOOKUP_FAILED"
  | "HOST_NOT_ALLOWED"
  | "INVALID_URL"
  | "MALFORMED_RESPONSE"
  | "NETWORK_FAILURE"
  | "RATE_LIMITED"
  | "REDIRECT_BLOCKED"
  | "RESPONSE_TOO_LARGE"
  | "RPC_NOT_CONFIGURED"
  | "TIMEOUT"
  | "UNSAFE_DESTINATION"
  | "UNSUPPORTED_CONTENT_TYPE"
  | "UPSTREAM_REJECTED";

export class AdapterError extends Error {
  public readonly code: AdapterErrorCode;
  public readonly retryable: boolean;
  public readonly status: number | null;

  public constructor(
    code: AdapterErrorCode,
    options: Readonly<{ retryable: boolean; status?: number | null }>
  ) {
    super(code);
    this.name = "AdapterError";
    this.code = code;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

export function toAdapterFailure(error: unknown): Readonly<{
  kind: "REJECTED" | "DEGRADED";
  code: string;
  message: string;
  retryable: boolean;
}> {
  if (error instanceof AdapterError) {
    return {
      kind: error.retryable ? "DEGRADED" : "REJECTED",
      code: error.code,
      message: "The upstream source could not be used safely.",
      retryable: error.retryable
    };
  }
  return {
    kind: "DEGRADED",
    code: "UNEXPECTED_ADAPTER_FAILURE",
    message: "The adapter failed without exposing upstream details.",
    retryable: true
  };
}

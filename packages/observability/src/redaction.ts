const sensitiveKeyPattern =
  /(?:authorization|cookie|password|secret|token|api[-_]?key|session|signature|connection[-_]?string|dsn|email|wallet|address|subject|user[-_]?id|actor[-_]?id|account[-_]?id)/iu;
const credentialUrlPattern = /\b(?:postgres(?:ql)?|redis|rediss):\/\/[^\s]+/giu;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]+/giu;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const evmAddressPattern = /\b0x[a-fA-F0-9]{40}\b/gu;
const privateNetworkUrlPattern =
  /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[?::1\]?|[^\s/:]+\.(?:internal|local))(?:[:/?#][^\s]*)?/giu;

export const REDACTED = "[REDACTED]";

function redactString(value: string): string {
  return value
    .replace(credentialUrlPattern, REDACTED)
    .replace(bearerPattern, REDACTED)
    .replace(emailPattern, REDACTED)
    .replace(evmAddressPattern, REDACTED)
    .replace(privateNetworkUrlPattern, REDACTED);
}

export function redactValue(value: unknown, key?: string, depth = 0): unknown {
  if (key !== undefined && sensitiveKeyPattern.test(key)) {
    return REDACTED;
  }
  if (depth > 8) {
    return "[MAX_DEPTH]";
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message)
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, undefined, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey, depth + 1)
    ])
  );
}

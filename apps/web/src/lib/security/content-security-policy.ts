import { randomBytes } from "node:crypto";

const CSP_NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;

export function createContentSecurityPolicyNonce(): string {
  return randomBytes(32).toString("base64");
}

export function deriveSupabaseConnectSources(configuredUrl: string | undefined): readonly string[] {
  if (configuredUrl === undefined || configuredUrl.trim() === "") return [];

  try {
    const url = new URL(configuredUrl.trim());
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.hostname.includes("*")
    )
      return [];

    const websocketUrl = new URL(url.origin);
    websocketUrl.protocol = "wss:";
    return [url.origin, websocketUrl.origin];
  } catch {
    return [];
  }
}

export function buildContentSecurityPolicy(input: {
  readonly development?: boolean | undefined;
  readonly nonce: string;
  readonly supabaseUrl?: string | undefined;
}): string {
  if (!CSP_NONCE_PATTERN.test(input.nonce) || input.nonce.length < 32)
    throw new Error("A valid cryptographic CSP nonce is required");

  const development = input.development ?? process.env.NODE_ENV !== "production";
  const connectSources = [
    "'self'",
    ...deriveSupabaseConnectSources(input.supabaseUrl),
    ...(development ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])
  ];
  const scriptSources = [
    "'self'",
    ...(development
      ? ["'unsafe-inline'", "'unsafe-eval'"]
      : [`'nonce-${input.nonce}'`, "'strict-dynamic'"])
  ];
  const styleSources = [
    "'self'",
    ...(development ? [] : [`'nonce-${input.nonce}'`]),
    ...(development ? ["'unsafe-inline'"] : [])
  ];

  return [
    "default-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    `style-src ${styleSources.join(" ")}`,
    // React style props become attributes. Keep this exception narrower than style-src itself.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
    ...(development ? [] : ["upgrade-insecure-requests"])
  ].join("; ");
}

const DEFAULT_SECURITY_CONTACT =
  "https://github.com/unrealwandregime/rwa-yield-router/security/advisories/new";

const requireUrl = (value: string, protocols: readonly string[]): URL => {
  const parsed = new URL(value);
  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password)
    throw new TypeError("Security policy URL is invalid");
  return parsed;
};

export function buildSecurityText(input: {
  readonly appUrl: string;
  readonly contactUrl?: string | undefined;
  readonly expiresAt: Date;
}): string {
  const appUrl = requireUrl(input.appUrl, ["http:", "https:"]);
  const contact = requireUrl(input.contactUrl ?? DEFAULT_SECURITY_CONTACT, ["https:"]);
  const canonical = new URL("/.well-known/security.txt", appUrl);
  const [owner, repository] = contact.pathname.split("/").filter(Boolean);
  const policy =
    owner && repository
      ? new URL(`/${owner}/${repository}/security/policy`, contact.origin)
      : new URL("/security/policy", contact.origin);
  return [
    `Contact: ${contact.toString()}`,
    `Expires: ${input.expiresAt.toISOString()}`,
    `Canonical: ${canonical.toString()}`,
    `Policy: ${policy.toString()}`,
    "Preferred-Languages: en",
    ""
  ].join("\n");
}

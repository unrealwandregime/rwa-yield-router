import { getServerConfig } from "@rwa-yield-router/config";
import { buildSecurityText } from "@/lib/security-text";

export const dynamic = "force-dynamic";

export function GET() {
  const config = getServerConfig();
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 180);
  return new Response(
    buildSecurityText({
      appUrl: config.appUrl,
      contactUrl: config.securityContactUrl,
      expiresAt
    }),
    {
      headers: {
        "cache-control": "public, max-age=3600, s-maxage=86400",
        "content-type": "text/plain; charset=utf-8"
      }
    }
  );
}

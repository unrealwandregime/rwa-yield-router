import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"]
  },
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,
  output: "standalone",
  reactStrictMode: true,
  transpilePackages: [
    "@rwa-yield-router/data-adapters",
    "@rwa-yield-router/database",
    "@rwa-yield-router/domain",
    "@rwa-yield-router/risk-engine",
    "@rwa-yield-router/routing-engine",
    "@rwa-yield-router/ui",
    "@rwa-yield-router/yield-engine"
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()"
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" }
        ]
      }
    ];
  }
};

export default nextConfig;

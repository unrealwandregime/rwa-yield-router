import { getPublicConfig } from "@rwa-yield-router/config";
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = getPublicConfig().appUrl;
  return {
    rules: [
      {
        allow: "/",
        disallow: [
          "/admin",
          "/alerts",
          "/api/internal",
          "/auth",
          "/settings",
          "/simulations",
          "/watchlist",
          "/wallet"
        ],
        userAgent: "*"
      }
    ],
    sitemap: `${base}/sitemap.xml`
  };
}

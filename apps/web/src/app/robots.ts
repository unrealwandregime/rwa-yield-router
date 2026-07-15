import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
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

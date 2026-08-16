import { getPublicConfig } from "@rwa-yield-router/config";
import type { MetadataRoute } from "next";
import { CATEGORY_VALUES, categorySlug } from "@/lib/constants";
import { getLiveCatalog } from "@/lib/live-morpho";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getPublicConfig().appUrl;
  const catalog = await getLiveCatalog();
  const staticPaths = [
    "",
    "/dashboard",
    "/screener",
    "/compare",
    "/simulator",
    "/methodology",
    "/sources",
    "/status",
    "/legal/disclaimer",
    "/legal/privacy",
    "/legal/terms"
  ];
  return [
    ...staticPaths.map((path) => ({
      changeFrequency: path === "" ? ("daily" as const) : ("weekly" as const),
      lastModified: new Date("2026-07-13T00:00:00.000Z"),
      priority: path === "" ? 1 : 0.7,
      url: `${base}${path}`
    })),
    ...CATEGORY_VALUES.map((category) => ({
      changeFrequency: "daily" as const,
      lastModified: new Date("2026-07-13T00:00:00.000Z"),
      priority: 0.8,
      url: `${base}/category/${categorySlug(category)}`
    })),
    ...catalog.map((record) => ({
      changeFrequency: "daily" as const,
      lastModified: new Date(record.verifiedAt),
      priority: 0.7,
      url: `${base}/routes/${record.slug}`
    })),
    ...[...new Map(catalog.map((record) => [record.productSlug, record])).values()].map(
      (record) => ({
        changeFrequency: "weekly" as const,
        lastModified: new Date(record.verifiedAt),
        priority: 0.6,
        url: `${base}/products/${record.productSlug}`
      })
    )
  ];
}

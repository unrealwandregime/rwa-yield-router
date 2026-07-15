import { and, eq, isNull } from "drizzle-orm";

import type { Database } from "../client.js";
import { productCategories, productRoutes, products, protocols } from "../schema/index.js";

export const getPublishedRouteById = async (database: Database, routeId: string) => {
  const [row] = await database
    .select({
      route: productRoutes,
      product: products,
      category: productCategories,
      protocol: protocols
    })
    .from(productRoutes)
    .innerJoin(products, eq(productRoutes.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(protocols, eq(productRoutes.protocolId, protocols.id))
    .where(
      and(
        eq(productRoutes.id, routeId),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        eq(productRoutes.lifecycleStatus, "ACTIVE"),
        eq(products.publicationStatus, "PUBLISHED"),
        eq(products.lifecycleStatus, "ACTIVE"),
        isNull(productRoutes.archivedAt),
        isNull(products.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
};

export const getPublishedProductBySlug = async (database: Database, slug: string) => {
  const [row] = await database
    .select({ product: products, category: productCategories })
    .from(products)
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .where(
      and(
        eq(products.slug, slug),
        eq(products.publicationStatus, "PUBLISHED"),
        eq(products.lifecycleStatus, "ACTIVE"),
        isNull(products.effectiveTo),
        isNull(products.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
};

export const getPublishedRouteBySlug = async (database: Database, slug: string) => {
  const [row] = await database
    .select({
      route: productRoutes,
      product: products,
      category: productCategories,
      protocol: protocols
    })
    .from(productRoutes)
    .innerJoin(products, eq(productRoutes.productId, products.id))
    .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
    .leftJoin(protocols, eq(productRoutes.protocolId, protocols.id))
    .where(
      and(
        eq(productRoutes.slug, slug),
        eq(productRoutes.publicationStatus, "PUBLISHED"),
        eq(productRoutes.lifecycleStatus, "ACTIVE"),
        isNull(productRoutes.effectiveTo),
        eq(products.publicationStatus, "PUBLISHED"),
        eq(products.lifecycleStatus, "ACTIVE"),
        isNull(products.effectiveTo),
        isNull(productRoutes.archivedAt),
        isNull(products.archivedAt)
      )
    )
    .limit(1);

  return row ?? null;
};

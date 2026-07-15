import "server-only";

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { getDatabase, productRoutes, yieldSnapshots } from "@rwa-yield-router/database";

export interface YieldHistoryPoint {
  readonly at: string;
  readonly value: string;
}

export async function getYieldHistory(routeSlug: string): Promise<YieldHistoryPoint[]> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const database = getDatabase();
    const [route] = await database
      .select({ id: productRoutes.id })
      .from(productRoutes)
      .where(
        and(
          eq(productRoutes.slug, routeSlug),
          eq(productRoutes.publicationStatus, "PUBLISHED"),
          isNull(productRoutes.effectiveTo)
        )
      )
      .limit(1);
    if (route === undefined) return [];
    const rows = await database
      .select({ at: yieldSnapshots.asOf, value: yieldSnapshots.netApy })
      .from(yieldSnapshots)
      .where(
        and(
          eq(yieldSnapshots.routeId, route.id),
          eq(yieldSnapshots.status, "AVAILABLE"),
          isNotNull(yieldSnapshots.netApy)
        )
      )
      .orderBy(desc(yieldSnapshots.asOf))
      .limit(365);
    return rows
      .flatMap((row) =>
        row.value === null ? [] : [{ at: row.at.toISOString(), value: row.value }]
      )
      .reverse();
  } catch {
    return [];
  }
}

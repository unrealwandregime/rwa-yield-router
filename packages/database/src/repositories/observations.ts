import { eq } from "drizzle-orm";

import type { Database } from "../client.js";
import {
  sourceObservations,
  type NewSourceObservation,
  type SourceObservation
} from "../schema/index.js";

export const appendSourceObservation = async (
  database: Database,
  observation: NewSourceObservation
): Promise<{ readonly inserted: boolean; readonly observation: SourceObservation }> => {
  const [inserted] = await database
    .insert(sourceObservations)
    .values(observation)
    .onConflictDoNothing({ target: sourceObservations.idempotencyKey })
    .returning();

  if (inserted !== undefined) {
    return { inserted: true, observation: inserted };
  }

  const [existing] = await database
    .select()
    .from(sourceObservations)
    .where(eq(sourceObservations.idempotencyKey, observation.idempotencyKey))
    .limit(1);

  if (existing === undefined) {
    throw new Error("Observation conflict occurred without a readable existing row");
  }
  return { inserted: false, observation: existing };
};

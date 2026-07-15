import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { readDatabaseUrl } from "./environment.js";
import * as schema from "./schema/index.js";

export interface DatabaseOptions {
  readonly connectionString?: string;
  readonly connectTimeoutSeconds?: number;
  readonly idleTimeoutSeconds?: number;
  readonly maxConnections?: number;
}

export const createDatabase = (options: DatabaseOptions = {}) => {
  const connection = postgres(options.connectionString ?? readDatabaseUrl(), {
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    max: options.maxConnections ?? 10,
    onnotice: () => undefined,
    prepare: true
  });

  return drizzle(connection, { schema });
};

export type Database = ReturnType<typeof createDatabase>;

let sharedDatabase: Database | undefined;

export const getDatabase = (options: DatabaseOptions = {}): Database => {
  if (sharedDatabase === undefined) {
    sharedDatabase = createDatabase(options);
  }
  return sharedDatabase;
};

export const closeDatabase = async (database: Database): Promise<void> => {
  await database.$client.end({ timeout: 5 });
  if (database === sharedDatabase) {
    sharedDatabase = undefined;
  }
};

export interface DatabaseHealth {
  readonly healthy: boolean;
  readonly checkedAt: Date;
  readonly latencyMs: number;
}

export const checkDatabaseHealth = async (
  database: Database = getDatabase()
): Promise<DatabaseHealth> => {
  const checkedAt = new Date();
  const startedAt = performance.now();
  try {
    await database.execute(sql`select 1 as healthy`);
    return {
      healthy: true,
      checkedAt,
      latencyMs: Math.max(0, performance.now() - startedAt)
    };
  } catch {
    return {
      healthy: false,
      checkedAt,
      latencyMs: Math.max(0, performance.now() - startedAt)
    };
  }
};

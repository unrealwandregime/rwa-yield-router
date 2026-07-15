import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";

import type { Database } from "./client.js";

const defaultMigrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export const runMigrations = async (
  database: Database,
  migrationsFolder: string = defaultMigrationsFolder
): Promise<void> => {
  await migrate(database, { migrationsFolder });
};

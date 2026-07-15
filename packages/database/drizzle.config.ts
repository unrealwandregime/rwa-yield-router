import { defineConfig } from "drizzle-kit";

import { readMigrationDatabaseUrl } from "./src/environment.js";

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: readMigrationDatabaseUrl()
  },
  migrations: {
    prefix: "index"
  },
  out: "./migrations",
  schema: "./src/schema/index.ts",
  strict: true,
  verbose: true
});

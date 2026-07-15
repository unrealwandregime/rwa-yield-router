import { closeDatabase, createDatabase } from "../client.js";
import { readMigrationDatabaseUrl } from "../environment.js";
import { runMigrations } from "../migrations.js";

const database = createDatabase({
  connectionString: readMigrationDatabaseUrl(),
  maxConnections: 1
});

try {
  await runMigrations(database);
  console.info("Database migrations applied successfully.");
} finally {
  await closeDatabase(database);
}

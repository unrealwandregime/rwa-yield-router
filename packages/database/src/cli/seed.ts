import { closeDatabase, createDatabase } from "../client.js";
import { readMigrationDatabaseUrl } from "../environment.js";
import { seedCanonicalReferenceData } from "../seed.js";

const database = createDatabase({
  connectionString: readMigrationDatabaseUrl(),
  maxConnections: 1
});

try {
  await seedCanonicalReferenceData(database);
  console.info("Canonical reference data seeded successfully; no live metrics were inserted.");
} finally {
  await closeDatabase(database);
}

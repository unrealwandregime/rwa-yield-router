import { closeDatabase, createDatabase } from "../client.js";
import { readMigrationDatabaseUrl } from "../environment.js";
import { importProductionCatalog } from "../production-catalog-import.js";

const database = createDatabase({
  connectionString: readMigrationDatabaseUrl(),
  maxConnections: 1
});

try {
  const result = await importProductionCatalog(database);
  console.info(JSON.stringify(result, null, 2));
} finally {
  await closeDatabase(database);
}

import { closeDatabase, createDatabase } from "../client.js";
import { readDatabaseUrl } from "../environment.js";
import { verifyDatabase } from "../verify.js";

const database = createDatabase({
  connectionString: readDatabaseUrl(),
  maxConnections: 1
});

try {
  const result = await verifyDatabase(database);
  if (!result.valid) {
    throw new Error(`Database verification failed:\n${result.issues.join("\n")}`);
  }
  console.info(`Database verification passed for ${result.checkedTableCount} required tables.`);
} finally {
  await closeDatabase(database);
}

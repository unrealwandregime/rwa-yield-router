import { z } from "zod";

import { grantInitialAdministrator } from "../admin-grant.js";
import { closeDatabase, createDatabase } from "../client.js";
import { readMigrationDatabaseUrl } from "../environment.js";

const argumentSchema = z
  .object({
    authSubjectId: z.string().trim().min(1).optional(),
    email: z.email().optional(),
    provider: z.string().trim().min(1).default("supabase"),
    reason: z.string().trim().min(8).max(2_000)
  })
  .refine((value) => (value.authSubjectId === undefined) !== (value.email === undefined), {
    message: "Provide exactly one of --email or --subject"
  });

const flags = new Map(
  process.argv.slice(2).map((argument) => {
    const [key, ...valueParts] = argument.replace(/^--/u, "").split("=");
    return [key, valueParts.join("=")] as const;
  })
);
const parsed = argumentSchema.parse({
  authSubjectId: flags.get("subject") || process.env.INITIAL_ADMIN_AUTH_SUBJECT || undefined,
  email: flags.get("email") || process.env.INITIAL_ADMIN_EMAIL || undefined,
  provider: flags.get("provider") || "supabase",
  reason:
    flags.get("reason") ||
    process.env.INITIAL_ADMIN_REASON ||
    "Initial administrator bootstrap performed through the server-only database CLI."
});
const database = createDatabase({
  connectionString: readMigrationDatabaseUrl(),
  maxConnections: 1
});

try {
  const result = await grantInitialAdministrator(database, {
    ...(parsed.authSubjectId === undefined ? {} : { authSubjectId: parsed.authSubjectId }),
    ...(parsed.email === undefined ? {} : { email: parsed.email }),
    provider: parsed.provider,
    reason: parsed.reason
  });
  console.info(JSON.stringify(result, null, 2));
} finally {
  await closeDatabase(database);
}

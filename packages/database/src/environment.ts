import { z } from "zod";

const postgresUrlSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
        context.addIssue({
          code: "custom",
          message: "must use the postgresql:// or postgres:// protocol"
        });
      }
      if (parsed.hostname.length === 0 || parsed.pathname.length <= 1) {
        context.addIssue({
          code: "custom",
          message: "must include a hostname and database name"
        });
      }
    } catch {
      context.addIssue({ code: "custom", message: "must be a valid PostgreSQL URL" });
    }
  });

export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

const readRequiredUrl = (key: string, environment: DatabaseEnvironment): string => {
  const result = postgresUrlSchema.safeParse(environment[key]);
  if (!result.success) {
    throw new Error(
      `Invalid ${key}: ${result.error.issues.map((issue) => issue.message).join(", ")}`
    );
  }
  return result.data;
};

export const readDatabaseUrl = (environment: DatabaseEnvironment = process.env): string =>
  readRequiredUrl("DATABASE_URL", environment);

export const readMigrationDatabaseUrl = (environment: DatabaseEnvironment = process.env): string =>
  environment.DATABASE_MIGRATION_URL === undefined ||
  environment.DATABASE_MIGRATION_URL.length === 0
    ? readDatabaseUrl(environment)
    : readRequiredUrl("DATABASE_MIGRATION_URL", environment);

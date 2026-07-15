import { describe, expect, it } from "vitest";

import { readDatabaseUrl, readMigrationDatabaseUrl } from "../src/environment.js";

describe("database environment", () => {
  it("accepts explicit PostgreSQL URLs without exposing their content", () => {
    const environment = {
      DATABASE_MIGRATION_URL: "postgresql://user:secret@db.example.test:5432/migrations",
      DATABASE_URL: "postgresql://user:secret@db.example.test:5432/application"
    };

    expect(readDatabaseUrl(environment)).toBe(environment.DATABASE_URL);
    expect(readMigrationDatabaseUrl(environment)).toBe(environment.DATABASE_MIGRATION_URL);
  });

  it("falls back to DATABASE_URL for migrations", () => {
    const environment = {
      DATABASE_URL: "postgres://user:secret@db.example.test/application"
    };

    expect(readMigrationDatabaseUrl(environment)).toBe(environment.DATABASE_URL);
  });

  it("rejects absent, non-PostgreSQL, and database-less values", () => {
    expect(() => readDatabaseUrl({})).toThrow("Invalid DATABASE_URL");
    expect(() => readDatabaseUrl({ DATABASE_URL: "https://db.example.test/database" })).toThrow(
      "Invalid DATABASE_URL"
    );
    expect(() => readDatabaseUrl({ DATABASE_URL: "postgresql://db.example.test" })).toThrow(
      "Invalid DATABASE_URL"
    );
  });
});

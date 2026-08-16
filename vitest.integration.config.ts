import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 120_000,
    include: ["packages/database/tests/**/*.integration.test.ts"],
    maxWorkers: 1,
    pool: "forks",
    testTimeout: 120_000
  }
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["tests/**/*.integration.test.ts"],
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    testTimeout: 10_000
  }
});

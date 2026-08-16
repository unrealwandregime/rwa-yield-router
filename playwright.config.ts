import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["github"]] : "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command:
          "pnpm exec turbo run build --filter=@rwa-yield-router/web... && pnpm --filter @rwa-yield-router/web start",
        env: {
          APP_URL: baseURL,
          DEPLOYMENT_TIER: "preview",
          EMAIL_TRANSPORT: "disabled",
          NODE_ENV: "test",
          OBSERVABILITY_MODE: "platform",
          REQUEST_TIME_PROVIDER_FETCH_ENABLED: "false",
          TRUSTED_PROXY_MODE: "none"
        },
        reuseExistingServer: false,
        timeout: 300_000,
        url: baseURL
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } }
  ]
});

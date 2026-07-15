import { getWebServerConfig } from "@rwa-yield-router/config";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build")
    getWebServerConfig();
}

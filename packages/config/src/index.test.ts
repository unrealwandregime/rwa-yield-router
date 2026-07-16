import { describe, expect, it } from "vitest";

import {
  loadClientConfig,
  loadServerConfig,
  loadWebServerConfig,
  loadWorkerServerConfig
} from "./index.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://app:password@db.example.com/router",
  REDIS_URL: "redis://localhost:6379"
};

describe("loadServerConfig", () => {
  it("applies safe development defaults", () => {
    const config = loadServerConfig(baseEnvironment);

    expect(config.nodeEnv).toBe("development");
    expect(config.morphoApiUrl).toBe("https://api.morpho.org/graphql");
    expect(config.observability.mode).toBe("external");
    expect(config.worker.concurrency).toBe(4);
    expect(config.rpcUrls).toEqual({});
  });

  it("requires TLS Redis and application URLs in production", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        NODE_ENV: "production",
        APP_URL: "http://router.example.com"
      })
    ).toThrow();
  });

  it("requires the selected email transport credential", () => {
    expect(() =>
      loadServerConfig({
        ...baseEnvironment,
        EMAIL_TRANSPORT: "resend"
      })
    ).toThrow();
  });
});

describe("loadClientConfig", () => {
  it("returns only explicitly public configuration", () => {
    const config = loadClientConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://auth.example.com",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon",
      DATABASE_URL: "postgresql://must-not-leak"
    });

    expect(config).toEqual({
      supabaseAnonKey: "public-anon",
      supabaseUrl: "https://auth.example.com"
    });
    expect("databaseUrl" in config).toBe(false);
  });
});

describe("production service configuration", () => {
  const productionEnvironment = {
    APP_URL: "https://router.example.com",
    DATABASE_URL: "postgresql://app:password@db.example.com/router?sslmode=require",
    DATA_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    EMAIL_FROM: "alerts@example.com",
    EMAIL_TRANSPORT: "resend",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
    NODE_ENV: "production",
    REDIS_URL: "rediss://cache.example.com:6380",
    RESEND_API_KEY: "resend-production-secret",
    SENTRY_DSN: "https://public@example.ingest.sentry.io/1"
  } as const;

  it("accepts complete TLS-only web and worker settings", () => {
    expect(loadWebServerConfig(productionEnvironment).nodeEnv).toBe("production");
    expect(loadWorkerServerConfig(productionEnvironment).email.transport).toBe("resend");
  });

  it("accepts explicit platform log observability without an external endpoint", () => {
    const platformEnvironment = {
      ...productionEnvironment,
      OBSERVABILITY_MODE: "platform",
      SENTRY_DSN: undefined
    } as const;

    expect(loadWebServerConfig(platformEnvironment).observability).toEqual({
      mode: "platform"
    });
    expect(loadWorkerServerConfig(platformEnvironment).observability).toEqual({
      mode: "platform"
    });
  });

  it("fails closed when critical production services are absent", () => {
    expect(() => loadWebServerConfig({ ...productionEnvironment, REDIS_URL: undefined })).toThrow(
      /REDIS_URL/u
    );
    expect(() =>
      loadWorkerServerConfig({ ...productionEnvironment, EMAIL_TRANSPORT: "disabled" })
    ).toThrow(/EMAIL_TRANSPORT=resend/u);
    expect(() => loadWebServerConfig({ ...productionEnvironment, SENTRY_DSN: undefined })).toThrow(
      /OBSERVABILITY_MODE=platform/u
    );
  });
});

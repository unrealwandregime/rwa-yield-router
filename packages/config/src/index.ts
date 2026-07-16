import { z } from "zod";

const nonEmptySecretSchema = z.string().trim().min(16);
const optionalSecretSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  nonEmptySecretSchema.optional()
);
const optionalUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.url().optional()
);
const optionalHttpsUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .url()
    .refine((value) => new URL(value).protocol === "https:", {
      message: "Expected an HTTPS URL"
    })
    .optional()
);

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.url().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    DATABASE_URL: optionalUrlSchema,
    DATABASE_MIGRATION_URL: optionalUrlSchema,
    REDIS_URL: optionalUrlSchema,
    DATA_ENCRYPTION_KEY: optionalSecretSchema,
    CRON_SHARED_SECRET: optionalSecretSchema,
    SUPABASE_SERVICE_ROLE_KEY: optionalSecretSchema,
    NEXT_PUBLIC_SUPABASE_URL: optionalHttpsUrlSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional()
    ),
    RPC_URL_ETHEREUM: optionalHttpsUrlSchema,
    RPC_URL_BASE: optionalHttpsUrlSchema,
    RPC_URL_ARBITRUM: optionalHttpsUrlSchema,
    MORPHO_API_URL: z
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "MORPHO_API_URL must use HTTPS"
      })
      .default("https://api.morpho.org/graphql"),
    PRICE_PROVIDER_URL: optionalHttpsUrlSchema,
    PRICE_PROVIDER_API_KEY: optionalSecretSchema,
    EMAIL_TRANSPORT: z.enum(["console", "resend", "disabled"]).default("console"),
    EMAIL_FROM: z.email().default("alerts@example.invalid"),
    RESEND_API_KEY: optionalSecretSchema,
    TELEGRAM_BOT_TOKEN: optionalSecretSchema,
    TELEGRAM_WEBHOOK_SECRET: optionalSecretSchema,
    OBSERVABILITY_MODE: z.enum(["external", "platform"]).default("external"),
    SENTRY_DSN: optionalHttpsUrlSchema,
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalHttpsUrlSchema,
    SECURITY_CONTACT_URL: optionalHttpsUrlSchema,
    WORKER_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
    SCHEDULES_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    INGEST_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
    RISK_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
    ALERT_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(300_000),
    ROLLUP_INTERVAL_MS: z.coerce.number().int().min(3_600_000).max(604_800_000).default(86_400_000),
    WORKER_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true")
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production") {
      if (new URL(value.APP_URL).protocol !== "https:") {
        context.addIssue({
          code: "custom",
          message: "APP_URL must use HTTPS in production",
          path: ["APP_URL"]
        });
      }
      const redisProtocol =
        value.REDIS_URL === undefined ? undefined : new URL(value.REDIS_URL).protocol;
      if (redisProtocol !== undefined && redisProtocol !== "rediss:") {
        context.addIssue({
          code: "custom",
          message: "REDIS_URL must use TLS in production",
          path: ["REDIS_URL"]
        });
      }
      for (const key of ["DATABASE_URL", "DATABASE_MIGRATION_URL"] as const) {
        const databaseUrl = value[key];
        if (databaseUrl === undefined) continue;
        const parsed = new URL(databaseUrl);
        const sslMode = parsed.searchParams.get("sslmode");
        if (
          (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
          !["require", "verify-ca", "verify-full"].includes(sslMode ?? "")
        )
          context.addIssue({
            code: "custom",
            message: `${key} must be PostgreSQL with sslmode=require or stronger in production`,
            path: [key]
          });
      }
      if (value.EMAIL_TRANSPORT === "console")
        context.addIssue({
          code: "custom",
          message: "Console email transport is forbidden in production",
          path: ["EMAIL_TRANSPORT"]
        });
    }
    if (value.EMAIL_TRANSPORT === "resend" && value.RESEND_API_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "RESEND_API_KEY is required when EMAIL_TRANSPORT is resend",
        path: ["RESEND_API_KEY"]
      });
    }
  });

const clientEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1)
  })
  .strict();

export type ServerConfig = Readonly<{
  nodeEnv: z.infer<typeof serverEnvironmentSchema>["NODE_ENV"];
  appUrl: string;
  logLevel: z.infer<typeof serverEnvironmentSchema>["LOG_LEVEL"];
  databaseUrl?: string | undefined;
  databaseMigrationUrl?: string | undefined;
  redisUrl?: string | undefined;
  dataEncryptionKey?: string | undefined;
  cronSharedSecret?: string | undefined;
  supabaseServiceRoleKey?: string | undefined;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
  rpcUrlEthereum?: string | undefined;
  rpcUrls: Readonly<Partial<Record<"ethereum" | "base" | "arbitrum", string | undefined>>>;
  morphoApiUrl: string;
  priceProviderUrl?: string | undefined;
  priceProviderApiKey?: string | undefined;
  securityContactUrl?: string | undefined;
  email: Readonly<{
    transport: z.infer<typeof serverEnvironmentSchema>["EMAIL_TRANSPORT"];
    from: string;
    resendApiKey?: string | undefined;
  }>;
  telegram: Readonly<{
    botToken?: string | undefined;
    webhookSecret?: string | undefined;
  }>;
  observability: Readonly<{
    mode: z.infer<typeof serverEnvironmentSchema>["OBSERVABILITY_MODE"];
    sentryDsn?: string | undefined;
    otlpEndpoint?: string | undefined;
  }>;
  worker: Readonly<{
    enabled: boolean;
    port: number;
    concurrency: number;
    schedules: Readonly<{
      enabled: boolean;
      ingestIntervalMs: number;
      riskIntervalMs: number;
      alertIntervalMs: number;
      rollupIntervalMs: number;
    }>;
  }>;
}>;

export type ClientConfig = Readonly<{
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}>;

function includeDefined<T extends Record<string, string | undefined>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined)
  ) as Partial<T>;
}

export function loadServerConfig(
  environment: Readonly<Record<string, string | undefined>>
): ServerConfig {
  const value = serverEnvironmentSchema.parse(environment);

  return {
    nodeEnv: value.NODE_ENV,
    appUrl: value.APP_URL,
    logLevel: value.LOG_LEVEL,
    ...includeDefined({
      databaseUrl: value.DATABASE_URL,
      databaseMigrationUrl: value.DATABASE_MIGRATION_URL,
      redisUrl: value.REDIS_URL,
      dataEncryptionKey: value.DATA_ENCRYPTION_KEY,
      cronSharedSecret: value.CRON_SHARED_SECRET,
      supabaseServiceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: value.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: value.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      rpcUrlEthereum: value.RPC_URL_ETHEREUM,
      priceProviderUrl: value.PRICE_PROVIDER_URL,
      priceProviderApiKey: value.PRICE_PROVIDER_API_KEY,
      securityContactUrl: value.SECURITY_CONTACT_URL
    }),
    rpcUrls: includeDefined({
      ethereum: value.RPC_URL_ETHEREUM,
      base: value.RPC_URL_BASE,
      arbitrum: value.RPC_URL_ARBITRUM
    }),
    morphoApiUrl: value.MORPHO_API_URL,
    email: {
      transport: value.EMAIL_TRANSPORT,
      from: value.EMAIL_FROM,
      ...includeDefined({ resendApiKey: value.RESEND_API_KEY })
    },
    telegram: includeDefined({
      botToken: value.TELEGRAM_BOT_TOKEN,
      webhookSecret: value.TELEGRAM_WEBHOOK_SECRET
    }),
    observability: {
      mode: value.OBSERVABILITY_MODE,
      ...includeDefined({
        sentryDsn: value.SENTRY_DSN,
        otlpEndpoint: value.OTEL_EXPORTER_OTLP_ENDPOINT
      })
    },
    worker: {
      enabled: value.WORKER_ENABLED,
      port: value.WORKER_PORT,
      concurrency: value.WORKER_CONCURRENCY,
      schedules: {
        alertIntervalMs: value.ALERT_INTERVAL_MS,
        enabled: value.SCHEDULES_ENABLED,
        ingestIntervalMs: value.INGEST_INTERVAL_MS,
        riskIntervalMs: value.RISK_INTERVAL_MS,
        rollupIntervalMs: value.ROLLUP_INTERVAL_MS
      }
    }
  };
}

export function loadClientConfig(
  environment: Readonly<Record<string, string | undefined>>
): ClientConfig {
  const value = clientEnvironmentSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  });

  return {
    supabaseUrl: value.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: value.NEXT_PUBLIC_SUPABASE_ANON_KEY
  };
}

export type PublicConfig = Readonly<{
  appUrl: string;
  supabaseUrl?: string | undefined;
  supabaseAnonKey?: string | undefined;
}>;

export function getServerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ServerConfig {
  return loadServerConfig(environment);
}

const requireProductionValues = (
  config: ServerConfig,
  requirements: ReadonlyArray<Readonly<{ name: string; value: unknown }>>
): void => {
  if (config.nodeEnv !== "production") return;
  const missing = requirements
    .filter(({ value }) => value === undefined || value === null || value === "")
    .map(({ name }) => name);
  if (missing.length > 0)
    throw new Error(`Missing required production configuration: ${missing.join(", ")}`);
};

export function loadWebServerConfig(
  environment: Readonly<Record<string, string | undefined>>
): ServerConfig {
  const config = loadServerConfig(environment);
  requireProductionValues(config, [
    { name: "DATABASE_URL", value: config.databaseUrl },
    { name: "REDIS_URL", value: config.redisUrl },
    { name: "NEXT_PUBLIC_SUPABASE_URL", value: config.supabaseUrl },
    { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", value: config.supabaseAnonKey },
    { name: "DATA_ENCRYPTION_KEY", value: config.dataEncryptionKey },
    {
      name: "OBSERVABILITY_MODE=platform or SENTRY_DSN or OTEL_EXPORTER_OTLP_ENDPOINT",
      value:
        config.observability.mode === "platform"
          ? config.observability.mode
          : (config.observability.sentryDsn ?? config.observability.otlpEndpoint)
    }
  ]);
  return config;
}

export function getWebServerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ServerConfig {
  return loadWebServerConfig(environment);
}

export function loadWorkerServerConfig(
  environment: Readonly<Record<string, string | undefined>>
): ServerConfig {
  const config = loadServerConfig(environment);
  requireProductionValues(config, [
    { name: "DATABASE_URL", value: config.databaseUrl },
    { name: "REDIS_URL", value: config.redisUrl },
    { name: "DATA_ENCRYPTION_KEY", value: config.dataEncryptionKey },
    {
      name: "OBSERVABILITY_MODE=platform or SENTRY_DSN or OTEL_EXPORTER_OTLP_ENDPOINT",
      value:
        config.observability.mode === "platform"
          ? config.observability.mode
          : (config.observability.sentryDsn ?? config.observability.otlpEndpoint)
    }
  ]);
  if (config.nodeEnv === "production" && config.email.transport !== "resend")
    throw new Error("EMAIL_TRANSPORT=resend is required for the production worker");
  return config;
}

export function getWorkerServerConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): ServerConfig {
  return loadWorkerServerConfig(environment);
}

export function getPublicConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): PublicConfig {
  const appUrl = z.url().parse(environment.APP_URL ?? "http://localhost:3000");
  return {
    appUrl,
    ...includeDefined({
      supabaseUrl: environment.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
    })
  };
}

export { clientEnvironmentSchema, serverEnvironmentSchema };

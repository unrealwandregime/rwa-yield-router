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

const canonicalApplicationUrlSchema = z.url().refine(
  (value) => {
    const parsed = new URL(value);
    return (
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/" &&
      parsed.search === "" &&
      parsed.hash === ""
    );
  },
  { message: "APP_URL must be a canonical origin without credentials, path, query, or fragment" }
);

const optionalRedisUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z
    .url()
    .refine((value) => ["redis:", "rediss:"].includes(new URL(value).protocol), {
      message: "REDIS_URL must use redis:// or rediss://"
    })
    .optional()
);

const supabaseUrlSchema = z.url().refine(
  (value) => {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      !parsed.hostname.includes("*")
    );
  },
  { message: "Supabase URL must be a credential-free HTTPS URL without wildcards" }
);

const optionalSupabaseUrlSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  supabaseUrlSchema.optional()
);

const MORPHO_API_URL = "https://api.morpho.org/graphql" as const;

const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: canonicalApplicationUrlSchema.default("http://localhost:3000"),
    DEPLOYMENT_TIER: z.enum(["preview", "production"]).default("production"),
    TRUSTED_PROXY_MODE: z.enum(["none", "render"]).default("none"),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    DATABASE_URL: optionalUrlSchema,
    DATABASE_MIGRATION_URL: optionalUrlSchema,
    REDIS_URL: optionalRedisUrlSchema,
    DATA_ENCRYPTION_KEY: optionalSecretSchema,
    CRON_SHARED_SECRET: optionalSecretSchema,
    SUPABASE_SERVICE_ROLE_KEY: optionalSecretSchema,
    NEXT_PUBLIC_SUPABASE_URL: optionalSupabaseUrlSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional()
    ),
    RPC_URL_ETHEREUM: optionalHttpsUrlSchema,
    RPC_URL_BASE: optionalHttpsUrlSchema,
    RPC_URL_ARBITRUM: optionalHttpsUrlSchema,
    MORPHO_API_URL: z.literal(MORPHO_API_URL).default(MORPHO_API_URL),
    REQUEST_TIME_PROVIDER_FETCH_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
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
        const sslModes = parsed.searchParams.getAll("sslmode");
        if (
          (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") ||
          sslModes.length !== 1 ||
          !["require", "verify-ca", "verify-full"].includes(sslModes[0] ?? "")
        )
          context.addIssue({
            code: "custom",
            message: `${key} must be PostgreSQL with exactly one sslmode=require or stronger in production`,
            path: [key]
          });
      }
      if (value.EMAIL_TRANSPORT === "console")
        context.addIssue({
          code: "custom",
          message: "Console email transport is forbidden in production",
          path: ["EMAIL_TRANSPORT"]
        });
      if (value.EMAIL_TRANSPORT === "resend" && value.EMAIL_FROM.toLowerCase().endsWith(".invalid"))
        context.addIssue({
          code: "custom",
          message: "EMAIL_FROM must be an explicitly configured deliverable sender in production",
          path: ["EMAIL_FROM"]
        });
      if (value.DEPLOYMENT_TIER === "production" && !value.REQUEST_TIME_PROVIDER_FETCH_ENABLED)
        context.addIssue({
          code: "custom",
          message: "REQUEST_TIME_PROVIDER_FETCH_ENABLED=false is restricted to degraded previews",
          path: ["REQUEST_TIME_PROVIDER_FETCH_ENABLED"]
        });
    }
    if (value.EMAIL_TRANSPORT === "resend" && value.RESEND_API_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "RESEND_API_KEY is required when EMAIL_TRANSPORT is resend",
        path: ["RESEND_API_KEY"]
      });
    }
    const supabaseValues = [value.NEXT_PUBLIC_SUPABASE_URL, value.NEXT_PUBLIC_SUPABASE_ANON_KEY];
    if (supabaseValues.filter((entry) => entry !== undefined).length === 1) {
      context.addIssue({
        code: "custom",
        message: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set together",
        path: ["NEXT_PUBLIC_SUPABASE_URL"]
      });
    }
  });

const clientEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrlSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().trim().min(1)
  })
  .strict();

const publicEnvironmentSchema = z
  .object({
    APP_URL: canonicalApplicationUrlSchema.default("http://localhost:3000"),
    NEXT_PUBLIC_SUPABASE_URL: optionalSupabaseUrlSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().trim().min(1).optional()
    )
  })
  .superRefine((value, context) => {
    const configured = [value.NEXT_PUBLIC_SUPABASE_URL, value.NEXT_PUBLIC_SUPABASE_ANON_KEY].filter(
      (entry) => entry !== undefined
    ).length;
    if (configured === 1) {
      context.addIssue({
        code: "custom",
        message: "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set together",
        path: ["NEXT_PUBLIC_SUPABASE_URL"]
      });
    }
  });

export type ServerConfig = Readonly<{
  nodeEnv: z.infer<typeof serverEnvironmentSchema>["NODE_ENV"];
  appUrl: string;
  deploymentTier: z.infer<typeof serverEnvironmentSchema>["DEPLOYMENT_TIER"];
  trustedProxyMode: z.infer<typeof serverEnvironmentSchema>["TRUSTED_PROXY_MODE"];
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
  requestTimeProviderFetchEnabled: boolean;
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
  supabaseUrl: string;
  supabaseAnonKey: string;
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
    deploymentTier: value.DEPLOYMENT_TIER,
    trustedProxyMode: value.TRUSTED_PROXY_MODE,
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
    requestTimeProviderFetchEnabled: value.REQUEST_TIME_PROVIDER_FETCH_ENABLED,
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
  const requirements = [
    { name: "DATABASE_URL", value: config.databaseUrl },
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
  ];
  requireProductionValues(
    config,
    config.deploymentTier === "production"
      ? [{ name: "REDIS_URL", value: config.redisUrl }, ...requirements]
      : requirements
  );
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
  if (
    config.nodeEnv === "production" &&
    config.deploymentTier === "production" &&
    config.email.transport !== "resend"
  )
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
  const value = publicEnvironmentSchema.parse({
    APP_URL: environment.APP_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL
  });
  return {
    appUrl: value.APP_URL,
    ...includeDefined({
      supabaseUrl: value.NEXT_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: value.NEXT_PUBLIC_SUPABASE_ANON_KEY
    })
  };
}

export { clientEnvironmentSchema, serverEnvironmentSchema };

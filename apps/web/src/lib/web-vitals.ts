import { z } from "zod";
import { getServerConfig } from "@rwa-yield-router/config";

export const webVitalPayloadSchema = z
  .object({
    delta: z.number().finite().min(-1_000_000).max(1_000_000),
    name: z.enum(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]),
    navigationType: z.enum([
      "back-forward",
      "back-forward-cache",
      "navigate",
      "prerender",
      "reload",
      "restore"
    ]),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    value: z.number().finite().min(0).max(1_000_000)
  })
  .strict();

export type WebVitalPayload = z.infer<typeof webVitalPayloadSchema>;

export function createWebVitalLogRecord(
  metric: WebVitalPayload,
  correlationId: string,
  observedAt = new Date()
): Readonly<Record<string, unknown>> {
  return {
    timestamp: observedAt.toISOString(),
    severity: "info",
    service: "rwa-yield-router-web",
    environment: getServerConfig().nodeEnv,
    event: "web_vital.observed",
    correlationId,
    metric
  };
}

export function normalizeWebVital(metric: unknown): WebVitalPayload | null {
  if (metric === null || typeof metric !== "object") return null;
  const candidate = metric as Readonly<Record<string, unknown>>;
  const parsed = webVitalPayloadSchema.safeParse({
    delta: candidate.delta,
    name: candidate.name,
    navigationType: candidate.navigationType,
    rating: candidate.rating,
    value: candidate.value
  });
  return parsed.success ? parsed.data : null;
}

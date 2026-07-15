import { eq } from "drizzle-orm";
import { userPreferences } from "@rwa-yield-router/database";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api";
import { authorizeMutation, authorizePrivateRequest } from "@/lib/authz";

const settingsSchema = z
  .object({
    chains: z.array(z.string().min(1).max(64)).max(20),
    jurisdiction: z
      .string()
      .length(2)
      .transform((value) => value.toUpperCase()),
    riskProfile: z.enum([
      "CAPITAL_PRESERVATION",
      "CONSERVATIVE",
      "BALANCED",
      "YIELD_SEEKING",
      "CUSTOM"
    ]),
    timezone: z.string().min(1).max(80)
  })
  .strict();

const presentationSchema = z
  .object({
    jurisdiction: z.string().optional(),
    preferredChainNames: z.array(z.string()).optional()
  })
  .passthrough();

export async function GET(request: NextRequest) {
  const access = await authorizePrivateRequest(request);
  if (!access.ok) return access.response;
  const [preference] = await access.value.database
    .select({
      presentation: userPreferences.presentation,
      riskProfile: userPreferences.riskProfile,
      timezone: userPreferences.timezone
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, access.value.authorization.userId))
    .limit(1);
  if (!preference)
    return Response.json({ data: null }, { headers: { "cache-control": "no-store" } });
  const presentation = presentationSchema.safeParse(preference.presentation);
  return Response.json(
    {
      data: {
        chains: presentation.success ? (presentation.data.preferredChainNames ?? []) : [],
        jurisdiction: presentation.success ? (presentation.data.jurisdiction ?? "") : "",
        riskProfile: preference.riskProfile,
        timezone: preference.timezone
      }
    },
    { headers: { "cache-control": "no-store" } }
  );
}

export async function PUT(request: NextRequest) {
  const access = await authorizeMutation(request);
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Settings are invalid.",
      undefined,
      parsed.error.flatten()
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone }).format();
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Timezone must be a valid IANA identifier.");
  }
  await access.value.database
    .insert(userPreferences)
    .values({
      presentation: {
        jurisdiction: parsed.data.jurisdiction,
        preferredChainNames: parsed.data.chains
      },
      riskProfile: parsed.data.riskProfile,
      timezone: parsed.data.timezone,
      userId: access.value.authorization.userId
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        presentation: {
          jurisdiction: parsed.data.jurisdiction,
          preferredChainNames: parsed.data.chains
        },
        riskProfile: parsed.data.riskProfile,
        timezone: parsed.data.timezone,
        updatedAt: new Date()
      }
    });
  return Response.json({ status: "SAVED" }, { headers: { "cache-control": "no-store" } });
}

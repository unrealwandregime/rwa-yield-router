import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";
import { getSecurityAuditSnapshot } from "@/lib/admin-service";

const requestSchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, {
    rateLimit: 20,
    securityAdministrator: true
  });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  if (!requestSchema.safeParse(body).success)
    return apiError(400, "VALIDATION_ERROR", "Security audit request is invalid.");
  try {
    return Response.json(
      { data: await getSecurityAuditSnapshot(access.value.database) },
      { headers: { "cache-control": "private, no-store" } }
    );
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Security audit data is unavailable.");
  }
}

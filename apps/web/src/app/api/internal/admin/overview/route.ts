import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";
import { getAdminSnapshot } from "@/lib/admin-service";

const requestSchema = z.object({}).strict();

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 30 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  if (!requestSchema.safeParse(body).success)
    return apiError(400, "VALIDATION_ERROR", "Overview request is invalid.");
  try {
    const data = await getAdminSnapshot(access.value.database);
    return Response.json({ data }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return apiError(503, "CONFIGURATION_UNAVAILABLE", "Administrative data is unavailable.");
  }
}

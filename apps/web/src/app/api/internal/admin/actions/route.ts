import type { NextRequest } from "next/server";
import { apiError, DEFAULT_JSON_BODY_LIMIT_BYTES, readBoundedJson } from "@/lib/api";
import { authorizeMutation } from "@/lib/authz";
import { adminActionSchema } from "@/lib/admin-contract";
import { AdminOperationError, executeAdminAction } from "@/lib/admin-service";

export async function POST(request: NextRequest) {
  const access = await authorizeMutation(request, { administrator: true, rateLimit: 30 });
  if (!access.ok) return access.response;
  let body: unknown;
  try {
    body = await readBoundedJson(request, DEFAULT_JSON_BODY_LIMIT_BYTES);
  } catch {
    return apiError(400, "VALIDATION_ERROR", "Request body must be valid JSON.");
  }
  const parsed = adminActionSchema.safeParse(body);
  if (!parsed.success)
    return apiError(
      400,
      "VALIDATION_ERROR",
      "Administrative action is invalid.",
      undefined,
      parsed.error.flatten()
    );
  try {
    const result = await executeAdminAction(
      access.value.database,
      access.value.authorization.userId,
      parsed.data
    );
    return Response.json(
      { data: result.data },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-correlation-id": result.correlationId
        }
      }
    );
  } catch (error) {
    if (error instanceof AdminOperationError) {
      return apiError(
        error.kind === "NOT_FOUND" ? 404 : 409,
        error.kind === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION_ERROR",
        error.message
      );
    }
    return apiError(409, "VALIDATION_ERROR", "The administrative action could not be applied.");
  }
}

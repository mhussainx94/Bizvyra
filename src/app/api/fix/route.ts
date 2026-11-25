import { enforceRateLimit, errorResponse, FINDINGS_BODY_MAX_BYTES, parseJsonBody } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateFixRequestSchema } from "@/lib/types";

/** POST /api/fix: write the fix for level 1 or 2 (docs/api-contract.md v2). The hardener arrives in T003. */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "fix", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateFixRequestSchema, FINDINGS_BODY_MAX_BYTES);
  if (!parsed.ok) return parsed.response;

  return errorResponse(501, "not_implemented", "The fix writer is not available yet. It arrives in task T003.");
}

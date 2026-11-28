import { enforceRateLimit, errorResponse, FINDINGS_BODY_MAX_BYTES, parseJsonBody } from "@/core/http";
import { writeFix } from "@/core/fix";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateFixRequestSchema, type CreateFixResponse } from "@/lib/types";

/** The optional LLM refinement takes at most 30 s including retries; the deterministic hardener needs no LLM. */
export const maxDuration = 60;

/**
 * POST /api/fix: write the fix for level 1 or 2 (docs/api-contract.md v2).
 * A valid request never gets HTTP 500: if the LLM refinement fails, the deterministic fix is returned.
 */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "fix", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateFixRequestSchema, FINDINGS_BODY_MAX_BYTES);
  if (!parsed.ok) return parsed.response;

  const outcome = await writeFix(parsed.data);
  if (!outcome.ok) {
    return outcome.reason === "unsupported"
      ? errorResponse(501, "not_implemented", "This module cannot write a fix yet.")
      : errorResponse(503, "upstream_error", "The fix could not be written. Please try again.");
  }
  const body: CreateFixResponse = { fix: outcome.fix };
  return Response.json(body);
}

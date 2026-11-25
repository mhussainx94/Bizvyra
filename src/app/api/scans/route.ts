import { enforceRateLimit, errorResponse, parseJsonBody, SCAN_BODY_MAX_BYTES } from "@/core/http";
import { planScan } from "@/core/orchestrator";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { getMode, takeDailyScan } from "@/core/security/usage";
import { CreateScanRequestSchema, type CreateScanResponse } from "@/lib/types";

/** POST /api/scans: plan a scan (docs/api-contract.md v2). Stores nothing. */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "scans", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateScanRequestSchema, SCAN_BODY_MAX_BYTES);
  if (!parsed.ok) return parsed.response;

  const usage = takeDailyScan(request, getMode());
  if (!usage.ok) {
    return errorResponse(429, "usage_limit", `Free tier limit reached: ${usage.limit} scans per day. Please try again tomorrow.`);
  }

  const body: CreateScanResponse = planScan(parsed.data);
  return Response.json(body, { status: 201 });
}

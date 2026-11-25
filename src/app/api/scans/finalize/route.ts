import { enforceRateLimit, FINDINGS_BODY_MAX_BYTES, parseJsonBody } from "@/core/http";
import { finalizeScan } from "@/core/orchestrator";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { FinalizeScanRequestSchema, type FinalizeScanResponse } from "@/lib/types";

/** POST /api/scans/finalize: score a finished scan (docs/api-contract.md v2). Pure computation. */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "scan-finalize", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, FinalizeScanRequestSchema, FINDINGS_BODY_MAX_BYTES);
  if (!parsed.ok) return parsed.response;

  const body: FinalizeScanResponse = { scan: finalizeScan(parsed.data) };
  return Response.json(body);
}

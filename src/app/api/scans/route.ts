import { enforceRateLimit, parseJsonBody } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateScanRequestSchema, type CreateScanResponse } from "@/lib/types";
import { mockCreateScan } from "@/mocks";

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "scans", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateScanRequestSchema);
  if (!parsed.ok) return parsed.response;

  const body: CreateScanResponse = mockCreateScan(parsed.data);
  return Response.json(body, { status: 201 });
}

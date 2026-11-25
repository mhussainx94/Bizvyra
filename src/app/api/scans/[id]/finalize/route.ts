import { enforceRateLimit, notFound, parseJsonBody, parseParams } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { FinalizeScanRequestSchema, IdParamsSchema, type FinalizeScanResponse } from "@/lib/types";
import { mockFinalizeScan } from "@/mocks";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = enforceRateLimit(request, "scan-finalize", RATE_LIMITS.default);
  if (limited) return limited;

  const params = parseParams(await ctx.params, IdParamsSchema);
  if (!params.ok) return params.response;
  const parsed = await parseJsonBody(request, FinalizeScanRequestSchema);
  if (!parsed.ok) return parsed.response;

  const result = mockFinalizeScan(params.data.id);
  if (!result) return notFound("Scan not found");
  const body: FinalizeScanResponse = result;
  return Response.json(body);
}

import { enforceRateLimit, notFound, parseJsonBody, parseParams } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { IdParamsSchema, RunStepRequestSchema, type RunStepResponse } from "@/lib/types";
import { mockRunStep } from "@/mocks";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = enforceRateLimit(request, "scan-step", RATE_LIMITS.scanStep);
  if (limited) return limited;

  const params = parseParams(await ctx.params, IdParamsSchema);
  if (!params.ok) return params.response;
  const parsed = await parseJsonBody(request, RunStepRequestSchema);
  if (!parsed.ok) return parsed.response;

  const result = mockRunStep(params.data.id, parsed.data.index);
  if (!result.ok) return notFound(result.reason === "scan_not_found" ? "Scan not found" : "Step not found");
  const body: RunStepResponse = { finding: result.finding };
  return Response.json(body);
}

import { enforceRateLimit, parseJsonBody, parseParams } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateFixRequestSchema, IdParamsSchema, type CreateFixResponse } from "@/lib/types";
import { mockCreateFix } from "@/mocks";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const limited = enforceRateLimit(request, "target-fix", RATE_LIMITS.default);
  if (limited) return limited;

  const params = parseParams(await ctx.params, IdParamsSchema);
  if (!params.ok) return params.response;
  const parsed = await parseJsonBody(request, CreateFixRequestSchema);
  if (!parsed.ok) return parsed.response;

  const body: CreateFixResponse = { fix: mockCreateFix(params.data.id, parsed.data.level) };
  return Response.json(body, { status: 201 });
}

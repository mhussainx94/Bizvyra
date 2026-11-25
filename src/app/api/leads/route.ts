import { enforceRateLimit, parseJsonBody } from "@/core/http";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateLeadRequestSchema, type CreateLeadResponse } from "@/lib/types";
import { mockCreateLead } from "@/mocks";

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "leads", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateLeadRequestSchema);
  if (!parsed.ok) return parsed.response;

  // Mock: validated but not stored (T002 wires the DB).
  const body: CreateLeadResponse = mockCreateLead();
  return Response.json(body, { status: 201 });
}

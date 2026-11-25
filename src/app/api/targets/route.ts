import { NextResponse } from "next/server";
import { enforceRateLimit, parseJsonBody } from "@/core/http";
import { getOrIssueOwnerToken, setOwnerCookie } from "@/core/security/owner";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { CreateTargetRequestSchema, type CreateTargetResponse } from "@/lib/types";
import { mockCreateTarget } from "@/mocks";

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "targets", RATE_LIMITS.default);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, CreateTargetRequestSchema);
  if (!parsed.ok) return parsed.response;

  // Owner identity: the token goes to the browser in an httpOnly cookie; only `owner.hash` is stored (T002 wires the DB).
  const owner = getOrIssueOwnerToken(request);
  const body: CreateTargetResponse = { target: mockCreateTarget(parsed.data) };
  const response = NextResponse.json(body, { status: 201 });
  setOwnerCookie(response, owner.token);
  return response;
}

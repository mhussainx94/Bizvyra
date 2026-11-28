import { enforceRateLimit, errorResponse, parseJsonBody, SCAN_BODY_MAX_BYTES } from "@/core/http";
import { runScanStep } from "@/core/orchestrator";
import { stepRateLimit } from "@/core/security/usage";
import { RunStepRequestSchema, type RunStepResponse } from "@/lib/types";

/**
 * Each LLM call (bot, L2 self-check, judge) takes at most 30 s including rate-limit retries (15 s per attempt),
 * so one step needs at most 90 s.
 */
export const maxDuration = 120;

/**
 * POST /api/scans/step: run and judge one step (docs/api-contract.md v2).
 * A valid request never gets HTTP 500: an LLM failure becomes a Finding with status "error".
 */
export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "scan-step", stepRateLimit());
  if (limited) return limited;

  const parsed = await parseJsonBody(request, RunStepRequestSchema, SCAN_BODY_MAX_BYTES);
  if (!parsed.ok) return parsed.response;

  const outcome = await runScanStep(parsed.data);
  if (!outcome.ok) {
    return errorResponse(400, "invalid_input", "Invalid input", {
      issues: [{ path: "step.checkId", message: "Unknown check" }],
    });
  }
  const body: RunStepResponse = { finding: outcome.finding };
  return Response.json(body);
}

import { enforceRateLimit, errorResponse, parseJsonBody } from "@/core/http";
import { chat } from "@/core/llm/adapter";
import { RATE_LIMITS } from "@/core/security/ratelimit";
import { DemoChatRequestSchema, LIMITS, type DemoChatResponse } from "@/lib/types";
import { DEMO_SYSTEM_PROMPT } from "@/modules/chatbot/demo-bot";

/** 20 messages x 4000 chars, Urdu is up to 3 bytes per char in UTF-8, plus JSON overhead. */
const MAX_BODY_BYTES = LIMITS.messagesMax * LIMITS.messageChars * 3 + 8 * 1024;

export async function POST(request: Request): Promise<Response> {
  const limited = enforceRateLimit(request, "demo-bot-chat", RATE_LIMITS.demoChat);
  if (limited) return limited;

  const parsed = await parseJsonBody(request, DemoChatRequestSchema, MAX_BODY_BYTES);
  if (!parsed.ok) return parsed.response;

  const result = await chat({ system: DEMO_SYSTEM_PROMPT, messages: parsed.data.messages, model: "fast" });
  if (!result.ok) {
    return errorResponse(502, "upstream_error", "The demo bot is unavailable right now. Please try again.");
  }
  const body: DemoChatResponse = { reply: result.text };
  return Response.json(body);
}

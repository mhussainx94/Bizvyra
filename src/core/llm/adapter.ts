/**
 * Provider-agnostic LLM adapter. One function, `chat`, used by every caller.
 * - Provider from LLM_PROVIDER: "gemini" (Gemini REST) or "openai_compatible" (LLM_BASE_URL, e.g. NVIDIA NIM).
 * - Model tier "fast" | "strong" | "judge" resolved from MODEL_FAST / MODEL_STRONG / MODEL_JUDGE
 *   (MODEL_JUDGE is optional and falls back to MODEL_FAST).
 * - LLM_REASONING=off (optional) adds `"reasoning": { "enabled": false }` to openai_compatible request bodies.
 * - Temperature 0, 15 s timeout, never throws, never logs or returns the API key.
 * Environment is read on each call, never at import time.
 */

export type LlmRole = "user" | "assistant";
export interface LlmMessage {
  role: LlmRole;
  content: string;
}
export type ModelTier = "fast" | "strong" | "judge";

export interface ChatArgs {
  system: string;
  messages: LlmMessage[];
  model: ModelTier;
  /** Ask the provider for a JSON-only reply. */
  json?: boolean;
  /** Output token budget; default LLM_MAX_OUTPUT_TOKENS, capped at LLM_MAX_OUTPUT_TOKENS_CAP. */
  maxOutputTokens?: number;
}

export type LlmErrorCode = "config" | "timeout" | "network" | "http" | "bad_response";
export interface LlmError {
  code: LlmErrorCode;
  /** Safe, generic message. Never contains the key, the prompt or the provider's body. */
  message: string;
  status?: number;
}

export type ChatResult = { ok: true; text: string } | { ok: false; error: LlmError };

export const LLM_TIMEOUT_MS = 15_000;
export const LLM_MAX_OUTPUT_TOKENS = 1024;
export const LLM_MAX_OUTPUT_TOKENS_CAP = 4096;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

type Provider = "gemini" | "openai_compatible";
interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** openai_compatible only: send `reasoning: { enabled: false }` (LLM_REASONING=off). */
  reasoningOff?: boolean;
}

/** Model id for a tier. MODEL_JUDGE falls back to MODEL_FAST when unset or empty. */
function modelFor(tier: ModelTier): string | undefined {
  const env = process.env;
  if (tier === "strong") return env.MODEL_STRONG?.trim();
  if (tier === "judge") return env.MODEL_JUDGE?.trim() || env.MODEL_FAST?.trim();
  return env.MODEL_FAST?.trim();
}

function outputTokens(args: ChatArgs): number {
  const n = args.maxOutputTokens;
  if (n === undefined || !Number.isInteger(n) || n < 1) return LLM_MAX_OUTPUT_TOKENS;
  return Math.min(n, LLM_MAX_OUTPUT_TOKENS_CAP);
}

function fail(code: LlmErrorCode, message: string, status?: number): ChatResult {
  return { ok: false, error: status === undefined ? { code, message } : { code, message, status } };
}

function readConfig(tier: ModelTier): { ok: true; config: LlmConfig } | { ok: false; result: ChatResult } {
  const env = process.env;
  const provider = env.LLM_PROVIDER?.trim();
  if (provider !== "gemini" && provider !== "openai_compatible") {
    return { ok: false, result: fail("config", "LLM provider is not configured") };
  }
  const apiKey = env.LLM_API_KEY?.trim();
  if (!apiKey) return { ok: false, result: fail("config", "LLM API key is not configured") };
  const model = modelFor(tier);
  if (!model) return { ok: false, result: fail("config", `Model for tier "${tier}" is not configured`) };

  if (provider === "openai_compatible") {
    const raw = env.LLM_BASE_URL?.trim();
    if (!raw) return { ok: false, result: fail("config", "LLM base URL is not configured") };
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, result: fail("config", "LLM base URL is invalid") };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, result: fail("config", "LLM base URL is invalid") };
    }
    const reasoningOff = env.LLM_REASONING?.trim().toLowerCase() === "off";
    return {
      ok: true,
      config: { provider, apiKey, model, baseUrl: raw.replace(/\/+$/, ""), ...(reasoningOff ? { reasoningOff } : {}) },
    };
  }
  return { ok: true, config: { provider, apiKey, model } };
}

interface BuiltRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Exported for tests: the exact request each provider receives. */
export function buildRequest(config: LlmConfig, args: ChatArgs): BuiltRequest {
  if (config.provider === "gemini") {
    return {
      url: `${GEMINI_BASE}/models/${encodeURIComponent(config.model)}:generateContent`,
      // Key in a header, never in the URL, so it cannot end up in access logs.
      headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
      body: {
        systemInstruction: { parts: [{ text: args.system }] },
        contents: args.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0,
          maxOutputTokens: outputTokens(args),
          ...(args.json ? { responseMimeType: "application/json" } : {}),
        },
      },
    };
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` },
    body: {
      model: config.model,
      messages: [
        { role: "system", content: args.system },
        ...args.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      temperature: 0,
      max_tokens: outputTokens(args),
      stream: false,
      ...(args.json ? { response_format: { type: "json_object" } } : {}),
      ...(config.reasoningOff ? { reasoning: { enabled: false } } : {}),
    },
  };
}

function extractText(provider: Provider, data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  if (provider === "gemini") {
    const candidates = (data as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const text = parts
      .map((p) => (typeof (p as { text?: unknown })?.text === "string" ? (p as { text: string }).text : ""))
      .join("");
    return text.length > 0 ? text : null;
  }
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const content = (choices[0] as { message?: { content?: unknown } })?.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

export async function chat(args: ChatArgs): Promise<ChatResult> {
  try {
    const cfg = readConfig(args.model);
    if (!cfg.ok) return cfg.result;
    const { config } = cfg;
    const req = buildRequest(config, args);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(req.url, {
          method: "POST",
          headers: req.headers,
          body: JSON.stringify(req.body),
          signal: controller.signal,
          cache: "no-store",
        });
      } catch {
        return controller.signal.aborted
          ? fail("timeout", "LLM request timed out")
          : fail("network", "LLM request failed");
      }
      if (!res.ok) {
        // Body is not read or returned: it may echo request details.
        return fail("http", "LLM provider returned an error", res.status);
      }
      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return controller.signal.aborted
          ? fail("timeout", "LLM request timed out")
          : fail("bad_response", "LLM provider returned an unreadable response");
      }
      const text = extractText(config.provider, data);
      if (text === null) return fail("bad_response", "LLM provider returned no text");
      return { ok: true, text };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return fail("network", "LLM request failed");
  }
}

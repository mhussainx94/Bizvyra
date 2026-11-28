/**
 * Provider-agnostic LLM adapter. One function, `chat`, used by every caller.
 * - Provider from LLM_PROVIDER: "gemini" (Gemini REST) or "openai_compatible" (LLM_BASE_URL, e.g. NVIDIA NIM).
 * - Model tier "fast" | "strong" | "judge" resolved from MODEL_FAST / MODEL_STRONG / MODEL_JUDGE
 *   (MODEL_JUDGE is optional and falls back to MODEL_FAST).
 * - LLM_REASONING=off (optional) adds `"reasoning": { "enabled": false }` to openai_compatible request bodies and
 *   `generationConfig.thinkingConfig.thinkingBudget = 0` to Gemini request bodies.
 * - Temperature 0, 15 s timeout per attempt, never throws, never logs or returns the API key.
 * - Retries HTTP 429/500/502/503/504 and network failures before a response: up to 3 retries with exponential
 *   backoff and jitter (about 1 s, 2 s, 4 s), honouring Retry-After (seconds or HTTP date), each wait capped at 10 s,
 *   all attempts within a 30 s total budget. Never retries other statuses (e.g. 400, 401, 403, 404) or timeouts.
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
/** The cause in plain terms, for finding evidence. */
export type LlmErrorKind = "rate_limited" | "unavailable" | "timeout" | "auth" | "bad_request" | "other";
export interface LlmError {
  code: LlmErrorCode;
  kind: LlmErrorKind;
  /** Safe, generic message. Never contains the key, the prompt or the provider's body. */
  message: string;
  status?: number;
}

export type ChatResult = { ok: true; text: string } | { ok: false; error: LlmError };

export const LLM_TIMEOUT_MS = 15_000;
export const LLM_MAX_OUTPUT_TOKENS = 1024;
export const LLM_MAX_OUTPUT_TOKENS_CAP = 4096;
/** Retries after the first attempt. */
export const LLM_MAX_RETRIES = 3;
/** Backoff before retry n (0-based) is LLM_RETRY_BASE_MS × 2^n, with ±25% jitter. */
export const LLM_RETRY_BASE_MS = 1_000;
/** Longest single wait between attempts, including a Retry-After value. */
export const LLM_RETRY_MAX_WAIT_MS = 10_000;
/** All attempts and waits of one call together. */
export const LLM_TOTAL_BUDGET_MS = 30_000;
/** A retry is only started when at least this much of the total budget is left after the wait. */
export const LLM_MIN_ATTEMPT_MS = 2_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

type Provider = "gemini" | "openai_compatible";
interface LlmConfig {
  provider: Provider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  /** LLM_REASONING=off: openai_compatible sends `reasoning: { enabled: false }`, Gemini a thinking budget of 0. */
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

/** Kind for each failure: status for HTTP errors, otherwise the code. */
export function errorKind(code: LlmErrorCode, status?: number): LlmErrorKind {
  if (code === "timeout") return "timeout";
  if (code === "network") return "unavailable";
  if (code !== "http" || status === undefined) return "other";
  if (status === 429) return "rate_limited";
  if (status === 401 || status === 403) return "auth";
  if (RETRY_STATUSES.has(status) || status >= 500) return "unavailable";
  if (status >= 400) return "bad_request";
  return "other";
}

function fail(code: LlmErrorCode, message: string, status?: number): ChatResult {
  const kind = errorKind(code, status);
  return { ok: false, error: status === undefined ? { code, kind, message } : { code, kind, message, status } };
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
  const reasoningOff = env.LLM_REASONING?.trim().toLowerCase() === "off";

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
    return {
      ok: true,
      config: { provider, apiKey, model, baseUrl: raw.replace(/\/+$/, ""), ...(reasoningOff ? { reasoningOff } : {}) },
    };
  }
  return { ok: true, config: { provider, apiKey, model, ...(reasoningOff ? { reasoningOff } : {}) } };
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
          ...(config.reasoningOff ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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

/**
 * Wait before the next attempt in ms: Retry-After when present and valid (delta seconds or HTTP date),
 * otherwise exponential backoff with ±25% jitter; never more than LLM_RETRY_MAX_WAIT_MS.
 */
export function retryDelayMs(retry: number, retryAfter: string | null, now: number = Date.now()): number {
  let ms: number | null = null;
  const value = retryAfter?.trim();
  if (value) {
    if (/^\d+(\.\d+)?$/.test(value)) ms = Number(value) * 1000;
    else if (/^[A-Za-z]{3}/.test(value)) {
      // HTTP dates (IMF-fixdate, RFC 850, asctime) start with a day name; Date.parse alone would accept "-5".
      const at = Date.parse(value);
      if (!Number.isNaN(at)) ms = Math.max(0, at - now);
    }
  }
  if (ms === null) ms = LLM_RETRY_BASE_MS * 2 ** retry * (0.75 + Math.random() * 0.5);
  return Math.min(Math.round(ms), LLM_RETRY_MAX_WAIT_MS);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type Attempt = { done: ChatResult } | { retry: ChatResult; retryAfter: string | null };

/** One HTTP attempt with its own timeout (15 s, or less when the total budget is nearly spent). */
async function attempt(config: LlmConfig, req: BuiltRequest, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
        ? { done: fail("timeout", "LLM request timed out") }
        : { retry: fail("network", "LLM request failed"), retryAfter: null };
    }
    if (!res.ok) {
      // Body is not read or returned: it may echo request details. Cancel it to free the connection.
      void res.body?.cancel().catch(() => {});
      const failure = fail("http", "LLM provider returned an error", res.status);
      return RETRY_STATUSES.has(res.status) ? { retry: failure, retryAfter: res.headers.get("retry-after") } : { done: failure };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return {
        done: controller.signal.aborted
          ? fail("timeout", "LLM request timed out")
          : fail("bad_response", "LLM provider returned an unreadable response"),
      };
    }
    const text = extractText(config.provider, data);
    if (text === null) return { done: fail("bad_response", "LLM provider returned no text") };
    return { done: { ok: true, text } };
  } finally {
    clearTimeout(timer);
  }
}

export async function chat(args: ChatArgs): Promise<ChatResult> {
  try {
    const cfg = readConfig(args.model);
    if (!cfg.ok) return cfg.result;
    const { config } = cfg;
    const req = buildRequest(config, args);

    const deadline = Date.now() + LLM_TOTAL_BUDGET_MS;
    for (let retry = 0; ; retry++) {
      const remaining = deadline - Date.now();
      const outcome = await attempt(config, req, Math.min(LLM_TIMEOUT_MS, remaining));
      if ("done" in outcome) return outcome.done;
      if (retry >= LLM_MAX_RETRIES) return outcome.retry;
      const wait = retryDelayMs(retry, outcome.retryAfter);
      // Give up when too little of the budget would be left for another attempt after the wait.
      if (Date.now() + wait + LLM_MIN_ATTEMPT_MS > deadline) return outcome.retry;
      await sleep(wait);
    }
  } catch {
    return fail("network", "LLM request failed");
  }
}

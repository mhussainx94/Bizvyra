import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chat,
  errorKind,
  LLM_RETRY_MAX_WAIT_MS,
  LLM_TIMEOUT_MS,
  LLM_TOTAL_BUDGET_MS,
  retryDelayMs,
  type ChatResult,
} from "./adapter";

const KEY = "test-key-should-never-leak-123";
const args = {
  system: "You are a test bot.",
  messages: [
    { role: "user" as const, content: "hello" },
    { role: "assistant" as const, content: "hi!" },
    { role: "user" as const, content: "codes?" },
  ],
  model: "fast" as const,
};

function geminiOk(text: string): Response {
  return Response.json({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe("llm adapter", () => {
  beforeEach(() => {
    vi.stubEnv("LLM_PROVIDER", "gemini");
    vi.stubEnv("LLM_API_KEY", KEY);
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("MODEL_FAST", "fast-model-1");
    vi.stubEnv("MODEL_STRONG", "strong-model-1");
    vi.stubEnv("MODEL_JUDGE", "");
    vi.stubEnv("LLM_REASONING", "");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ok:false (config) when the API key is missing, without calling fetch", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await chat(args);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("config");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false (config) when the provider is unknown", async () => {
    vi.stubEnv("LLM_PROVIDER", "something_else");
    vi.stubGlobal("fetch", vi.fn());
    const res = await chat(args);
    expect(res).toEqual({ ok: false, error: { code: "config", kind: "other", message: "LLM provider is not configured" } });
  });

  it("returns ok:false (timeout) after 15 s and never throws", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    const pending = chat(args);
    await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS - 1);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("timeout");
  });

  it("sends the Gemini REST request body (temperature 0, key in header, system instruction)", async () => {
    const fetchMock = vi.fn(async () => geminiOk("hello back"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await chat({ ...args, json: true });
    expect(res).toEqual({ ok: true, text: "hello back" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/fast-model-1:generateContent");
    expect(url).not.toContain(KEY);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body as string)).toEqual({
      systemInstruction: { parts: [{ text: "You are a test bot." }] },
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi!" }] },
        { role: "user", parts: [{ text: "codes?" }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024, responseMimeType: "application/json" },
    });
  });

  it("sends the OpenAI-compatible request body (NIM) with MODEL_STRONG", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai_compatible");
    vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1/");
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "strong reply" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await chat({ ...args, model: "strong" });
    expect(res).toEqual({ ok: true, text: "strong reply" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://llm.example.test/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toEqual({
      model: "strong-model-1",
      messages: [
        { role: "system", content: "You are a test bot." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi!" },
        { role: "user", content: "codes?" },
      ],
      temperature: 0,
      max_tokens: 1024,
      stream: false,
    });
  });

  it("maps HTTP and network failures to typed errors that never contain the key", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`bad key ${KEY}`, { status: 401 })));
    const http = await chat(args);
    expect(http).toEqual({ ok: false, error: { code: "http", kind: "auth", message: "LLM provider returned an error", status: 401 } });
    expect(JSON.stringify(http)).not.toContain(KEY);

    // A network failure is retried (T004); fake timers skip the backoff.
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error(`boom ${KEY}`))));
    const pending = chat(args);
    await vi.runAllTimersAsync();
    const net = await pending;
    expect(net).toEqual({ ok: false, error: { code: "network", kind: "unavailable", message: "LLM request failed" } });
    expect(JSON.stringify(net)).not.toContain(KEY);
    vi.useRealTimers();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ candidates: [] })));
    const empty = await chat(args);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe("bad_response");
  });

  describe("MODEL_JUDGE and LLM_REASONING (T003)", () => {
    const nimBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
      JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

    beforeEach(() => {
      vi.stubEnv("LLM_PROVIDER", "openai_compatible");
      vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1");
    });

    it("judge tier uses MODEL_JUDGE when set", async () => {
      vi.stubEnv("MODEL_JUDGE", "judge-model-1");
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
      vi.stubGlobal("fetch", fetchMock);
      expect((await chat({ ...args, model: "judge", json: true })).ok).toBe(true);
      expect(nimBody(fetchMock).model).toBe("judge-model-1");
    });

    it("judge tier falls back to MODEL_FAST when MODEL_JUDGE is unset or blank", async () => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "{}" } }] }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("MODEL_JUDGE", "");
      await chat({ ...args, model: "judge" });
      vi.stubEnv("MODEL_JUDGE", "   ");
      await chat({ ...args, model: "judge" });
      delete process.env.MODEL_JUDGE;
      await chat({ ...args, model: "judge" });
      expect([0, 1, 2].map((i) => nimBody(fetchMock, i).model)).toEqual(["fast-model-1", "fast-model-1", "fast-model-1"]);
      // fast tier never uses MODEL_JUDGE
      vi.stubEnv("MODEL_JUDGE", "judge-model-1");
      await chat({ ...args, model: "fast" });
      expect(nimBody(fetchMock, 3).model).toBe("fast-model-1");
    });

    it("judge tier with neither MODEL_JUDGE nor MODEL_FAST is a config error", async () => {
      vi.stubEnv("MODEL_FAST", "");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const res = await chat({ ...args, model: "judge" });
      expect(res).toEqual({ ok: false, error: { code: "config", kind: "other", message: 'Model for tier "judge" is not configured' } });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("LLM_REASONING=off adds reasoning.enabled=false to openai_compatible bodies only", async () => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("LLM_REASONING", "off");
      await chat(args);
      expect(nimBody(fetchMock)).toEqual({
        model: "fast-model-1",
        messages: [
          { role: "system", content: "You are a test bot." },
          { role: "user", content: "hello" },
          { role: "assistant", content: "hi!" },
          { role: "user", content: "codes?" },
        ],
        temperature: 0,
        max_tokens: 1024,
        stream: false,
        reasoning: { enabled: false },
      });
      vi.stubEnv("LLM_REASONING", " OFF ");
      await chat({ ...args, json: true });
      expect(nimBody(fetchMock, 1)).toMatchObject({ reasoning: { enabled: false }, response_format: { type: "json_object" } });

      // Gemini never gets the openai_compatible "reasoning" field (it gets a thinking budget instead, T004).
      vi.stubEnv("LLM_PROVIDER", "gemini");
      const gemini = vi.fn(async () => geminiOk("ok"));
      vi.stubGlobal("fetch", gemini);
      await chat(args);
      expect(nimBody(gemini)).not.toHaveProperty("reasoning");
      expect(JSON.stringify(nimBody(gemini))).not.toContain("reasoning");
      expect(nimBody(gemini).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    });

    it("request bodies are unchanged when LLM_REASONING is unset or any other value", async () => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
      vi.stubGlobal("fetch", fetchMock);
      delete process.env.LLM_REASONING;
      await chat(args);
      vi.stubEnv("LLM_REASONING", "on");
      await chat(args);
      vi.stubEnv("LLM_REASONING", "false");
      await chat(args);
      for (const i of [0, 1, 2]) {
        expect(Object.keys(nimBody(fetchMock, i)).sort()).toEqual(["max_tokens", "messages", "model", "stream", "temperature"]);
      }
    });

    it("maxOutputTokens overrides the default and is capped", async () => {
      const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] }));
      vi.stubGlobal("fetch", fetchMock);
      await chat({ ...args, maxOutputTokens: 3000 });
      await chat({ ...args, maxOutputTokens: 999_999 });
      await chat({ ...args, maxOutputTokens: 0 });
      expect([0, 1, 2].map((i) => nimBody(fetchMock, i).max_tokens)).toEqual([3000, 4096, 1024]);
    });
  });

  describe("retry, backoff and error kinds (T004)", () => {
    const status = (code: number, headers: Record<string, string> = {}) => new Response(`provider body ${KEY}`, { status: code, headers });
    /** Fetch mock that answers each call from `replies` in turn (the last one repeats). */
    const sequence = (...replies: Array<() => Response | Promise<Response>>) => {
      let i = 0;
      return vi.fn(async () => replies[Math.min(i++, replies.length - 1)]());
    };
    /** Starts `chat`, returns helpers to advance fake time and read the result once settled. */
    function start(): { pending: Promise<ChatResult>; settled: () => boolean } {
      let done = false;
      const pending = chat(args);
      void pending.then(() => (done = true));
      return { pending, settled: () => done };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-28T10:00:00.000Z"));
      vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter factor exactly 1.0
    });

    it("429 then success: retries once after about 1 s", async () => {
      const fetchMock = sequence(() => status(429), () => geminiOk("second try"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(await pending).toEqual({ ok: true, text: "second try" });
    });

    it("network failure before a response is retried", async () => {
      const fetchMock = sequence(() => Promise.reject(new TypeError("fetch failed")), () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(1000);
      expect(await pending).toEqual({ ok: true, text: "ok" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("429 with Retry-After in seconds waits that long instead of the backoff", async () => {
      const fetchMock = sequence(() => status(429, { "retry-after": "3" }), () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await pending).ok).toBe(true);
    });

    it("429 with Retry-After as an HTTP date waits until that time", async () => {
      const at = new Date(Date.now() + 5000).toUTCString();
      const fetchMock = sequence(() => status(429, { "retry-after": at }), () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(4999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await pending).ok).toBe(true);
    });

    it("Retry-After is capped at 10 s per wait", async () => {
      const fetchMock = sequence(() => status(429, { "retry-after": "120" }), () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(LLM_RETRY_MAX_WAIT_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect((await pending).ok).toBe(true);
    });

    it("503 on every attempt: 3 retries after 1 s, 2 s and 4 s, then ok:false (unavailable)", async () => {
      const fetchMock = sequence(() => status(503));
      vi.stubGlobal("fetch", fetchMock);
      const { pending, settled } = start();
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(3999);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const res = await pending;
      expect(settled()).toBe(true);
      expect(res).toEqual({ ok: false, error: { code: "http", kind: "unavailable", message: "LLM provider returned an error", status: 503 } });
      expect(JSON.stringify(res)).not.toContain(KEY);
      expect(JSON.stringify(res)).not.toContain("provider body");
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(4); // never a 5th attempt
    });

    it("503 three times, then success on the last retry", async () => {
      const fetchMock = sequence(() => status(503), () => status(503), () => status(503), () => geminiOk("finally"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ ok: true, text: "finally" });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it.each([500, 502, 504])("HTTP %i is retried", async (code) => {
      const fetchMock = sequence(() => status(code), () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.runAllTimersAsync();
      expect((await pending).ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([
      [400, "bad_request"],
      [401, "auth"],
      [403, "auth"],
      [404, "bad_request"],
    ] as const)("HTTP %i is never retried (kind %s)", async (code, kind) => {
      const fetchMock = sequence(() => status(code), () => geminiOk("should not be reached"));
      vi.stubGlobal("fetch", fetchMock);
      const { pending, settled } = start();
      await vi.advanceTimersByTimeAsync(0);
      expect(settled()).toBe(true);
      expect(await pending).toEqual({ ok: false, error: { code: "http", kind, message: "LLM provider returned an error", status: code } });
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a timeout is not retried (one 15 s attempt)", async () => {
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { pending } = start();
      await vi.advanceTimersByTimeAsync(LLM_TIMEOUT_MS);
      expect(await pending).toEqual({ ok: false, error: { code: "timeout", kind: "timeout", message: "LLM request timed out" } });
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("total budget: stops retrying when the next wait would leave no time for another attempt", async () => {
      // Retry-After 10 s each time: attempts at 0 s, 10 s, 20 s; a 4th at 30 s would exceed the 30 s budget.
      const fetchMock = sequence(() => status(429, { "retry-after": "10" }));
      vi.stubGlobal("fetch", fetchMock);
      const t0 = Date.now();
      const { pending, settled } = start();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(settled()).toBe(true);
      expect(Date.now() - t0).toBeLessThanOrEqual(LLM_TOTAL_BUDGET_MS);
      expect(await pending).toEqual({ ok: false, error: { code: "http", kind: "rate_limited", message: "LLM provider returned an error", status: 429 } });
      await vi.runAllTimersAsync();
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("total budget: slow failures never let one call run past 30 s", async () => {
      // Each attempt answers 503 after 12 s, unless aborted first.
      const fetchMock = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const t = setTimeout(() => resolve(status(503)), 12_000);
            init.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const t0 = Date.now();
      const { pending, settled } = start();
      // 0-12 s attempt 1 · 1 s wait · 13-25 s attempt 2 · 2 s wait · 27 s attempt 3, cut at 30 s by the budget.
      await vi.advanceTimersByTimeAsync(LLM_TOTAL_BUDGET_MS - 1);
      expect(settled()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled()).toBe(true);
      expect(Date.now() - t0).toBe(LLM_TOTAL_BUDGET_MS);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const res = await pending;
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.kind).toBe("timeout");
    });

    it("error kinds: every failure carries one of the six kinds", async () => {
      expect(errorKind("http", 429)).toBe("rate_limited");
      for (const s of [500, 501, 502, 503, 504, 529]) expect(errorKind("http", s)).toBe("unavailable");
      expect(errorKind("network")).toBe("unavailable");
      expect(errorKind("timeout")).toBe("timeout");
      expect(errorKind("http", 401)).toBe("auth");
      expect(errorKind("http", 403)).toBe("auth");
      for (const s of [400, 404, 409, 413, 422]) expect(errorKind("http", s)).toBe("bad_request");
      expect(errorKind("config")).toBe("other");
      expect(errorKind("bad_response")).toBe("other");
      expect(errorKind("http", 302)).toBe("other");

      // End to end: 429 that never clears → rate_limited after the retries.
      vi.stubGlobal("fetch", sequence(() => status(429)));
      const { pending } = start();
      await vi.runAllTimersAsync();
      const limited = await pending;
      expect(limited.ok).toBe(false);
      if (!limited.ok) expect(limited.error.kind).toBe("rate_limited");

      // A reply with no text is bad_response / other and is not retried.
      const empty = sequence(() => Response.json({ candidates: [] }));
      vi.stubGlobal("fetch", empty);
      const second = start();
      await vi.runAllTimersAsync();
      expect(await second.pending).toEqual({ ok: false, error: { code: "bad_response", kind: "other", message: "LLM provider returned no text" } });
      expect(empty).toHaveBeenCalledTimes(1);
    });

    it("retryDelayMs: backoff with ±25% jitter, Retry-After seconds or date, 10 s cap", () => {
      const now = Date.parse("2026-11-28T10:00:00.000Z");
      expect([0, 1, 2].map((n) => retryDelayMs(n, null, now))).toEqual([1000, 2000, 4000]);
      vi.spyOn(Math, "random").mockReturnValue(0);
      expect([0, 1, 2].map((n) => retryDelayMs(n, null, now))).toEqual([750, 1500, 3000]);
      vi.spyOn(Math, "random").mockReturnValue(0.999999);
      expect([0, 1, 2].map((n) => retryDelayMs(n, null, now))).toEqual([1250, 2500, 5000]);
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      expect(retryDelayMs(0, "2", now)).toBe(2000);
      expect(retryDelayMs(0, "0", now)).toBe(0);
      expect(retryDelayMs(0, "1.5", now)).toBe(1500);
      expect(retryDelayMs(0, "11", now)).toBe(10_000);
      expect(retryDelayMs(0, new Date(now + 7000).toUTCString(), now)).toBe(7000);
      expect(retryDelayMs(0, new Date(now - 7000).toUTCString(), now)).toBe(0); // date in the past
      expect(retryDelayMs(0, new Date(now + 60_000).toUTCString(), now)).toBe(10_000);
      expect(retryDelayMs(1, "soon", now)).toBe(2000); // unparseable → backoff
      expect(retryDelayMs(1, "-5", now)).toBe(2000);
      expect(retryDelayMs(1, "", now)).toBe(2000);
    });
  });

  describe("Gemini thinking budget with LLM_REASONING=off (T004)", () => {
    const body = (fetchMock: ReturnType<typeof vi.fn>, call = 0) =>
      JSON.parse((fetchMock.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);
    const BASE_BODY = {
      systemInstruction: { parts: [{ text: "You are a test bot." }] },
      contents: [
        { role: "user", parts: [{ text: "hello" }] },
        { role: "model", parts: [{ text: "hi!" }] },
        { role: "user", parts: [{ text: "codes?" }] },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 1024 },
    };

    it("adds generationConfig.thinkingConfig.thinkingBudget = 0", async () => {
      vi.stubEnv("LLM_REASONING", "off");
      const fetchMock = vi.fn(async () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      await chat(args);
      expect(body(fetchMock)).toEqual({
        ...BASE_BODY,
        generationConfig: { temperature: 0, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      });
      vi.stubEnv("LLM_REASONING", " Off ");
      await chat({ ...args, json: true });
      expect(body(fetchMock, 1).generationConfig).toEqual({
        temperature: 0,
        maxOutputTokens: 1024,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      });
    });

    it("Gemini bodies are unchanged when LLM_REASONING is unset, blank or any other value", async () => {
      const fetchMock = vi.fn(async () => geminiOk("ok"));
      vi.stubGlobal("fetch", fetchMock);
      delete process.env.LLM_REASONING;
      await chat(args);
      vi.stubEnv("LLM_REASONING", "");
      await chat(args);
      vi.stubEnv("LLM_REASONING", "on");
      await chat(args);
      for (const i of [0, 1, 2]) expect(body(fetchMock, i)).toEqual(BASE_BODY);
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chat, LLM_TIMEOUT_MS } from "./adapter";

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
    expect(res).toEqual({ ok: false, error: { code: "config", message: "LLM provider is not configured" } });
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
    expect(http).toEqual({ ok: false, error: { code: "http", message: "LLM provider returned an error", status: 401 } });
    expect(JSON.stringify(http)).not.toContain(KEY);

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error(`boom ${KEY}`))));
    const net = await chat(args);
    expect(net.ok).toBe(false);
    expect(JSON.stringify(net)).not.toContain(KEY);

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
      expect(res).toEqual({ ok: false, error: { code: "config", message: 'Model for tier "judge" is not configured' } });
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

      // Gemini bodies are never changed by LLM_REASONING.
      vi.stubEnv("LLM_PROVIDER", "gemini");
      const gemini = vi.fn(async () => geminiOk("ok"));
      vi.stubGlobal("fetch", gemini);
      await chat(args);
      expect(nimBody(gemini)).not.toHaveProperty("reasoning");
      expect(JSON.stringify(nimBody(gemini))).not.toContain("reasoning");
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
});

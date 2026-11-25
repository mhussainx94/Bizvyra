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
});

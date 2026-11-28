import { describe, expect, it, vi } from "vitest";
import {
  USE_MOCKS,
  createFix,
  demoChat,
  finalizeScan,
  planScan,
  runStep,
} from "@/components/api-client";
import {
  CreateFixRequestSchema,
  CreateScanRequestSchema,
  DemoChatRequestSchema,
  FinalizeScanRequestSchema,
  RunStepRequestSchema,
  type CreateScanResponse,
} from "@/lib/types";
import { errorFromResponse, postJson, type FetchLike } from "./http";
import { SAMPLE_RUN } from "./sample-run";

/** Fetch is always mocked: no test reaches the API or an LLM provider. */

const L0 = SAMPLE_RUN.runs[0];
const FIX1 = SAMPLE_RUN.fixes["1"];

function planResponse(): CreateScanResponse {
  return {
    scan: { ...L0.scan, status: "running", score: null, grade: null, summary: null, finishedAt: null },
    steps: L0.findings.map((f, index) => ({
      id: f.checkId,
      index,
      module: "chatbot" as const,
      checkId: f.checkId,
      level: 0 as const,
      lang: f.lang,
      intent: f.intent,
      technique: f.technique,
    })),
    concurrency: 3,
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** A fetch mock that records the call and answers with `res`. */
function fakeFetch(res: Response | (() => Response | Promise<Response>)) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn: FetchLike = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return typeof res === "function" ? res() : res;
  });
  return { fn, calls };
}

function sentBody(calls: { init: RequestInit | undefined }[]): unknown {
  expect(calls).toHaveLength(1);
  expect(calls[0].init?.method).toBe("POST");
  expect(new Headers(calls[0].init?.headers).get("content-type")).toBe("application/json");
  return JSON.parse(String(calls[0].init?.body));
}

describe("api-client: real API by default", () => {
  it("USE_MOCKS is false unless NEXT_PUBLIC_USE_MOCKS=true", () => {
    expect(process.env.NEXT_PUBLIC_USE_MOCKS).toBeUndefined();
    expect(USE_MOCKS).toBe(false);
  });
});

describe("api-client: request bodies and response parsing for all five routes", () => {
  it("POST /api/scans", async () => {
    const { fn, calls } = fakeFetch(jsonResponse(planResponse(), 201));
    const req = { target: { mode: "demo" as const }, level: 0 as const, kind: "baseline" as const, size: "quick" as const };
    const res = await planScan(req, { fetchImpl: fn });
    expect(calls[0].url).toBe("/api/scans");
    expect(CreateScanRequestSchema.parse(sentBody(calls))).toEqual(req);
    expect(res.ok && res.data.steps).toHaveLength(30);
    expect(res.ok && res.data.concurrency).toBe(3);
  });

  it("POST /api/scans for a retest sends the fix", async () => {
    const { fn, calls } = fakeFetch(jsonResponse(planResponse(), 201));
    const req = {
      target: { mode: "prompt" as const, name: "My bot", systemPrompt: "You are a shop bot.", protectedAssets: ["EID50"] },
      level: 1 as const,
      kind: "retest" as const,
      size: "full" as const,
      fix: FIX1,
    };
    const res = await planScan(req, { fetchImpl: fn });
    expect(res.ok).toBe(true);
    expect(CreateScanRequestSchema.parse(sentBody(calls))).toEqual(req);
  });

  it("POST /api/scans/step", async () => {
    const finding = L0.findings[0];
    const { fn, calls } = fakeFetch(jsonResponse({ finding }));
    const req = { scanId: L0.scan.id, level: 0 as const, step: { checkId: finding.checkId }, target: { mode: "demo" as const } };
    const res = await runStep(req, { fetchImpl: fn });
    expect(calls[0].url).toBe("/api/scans/step");
    expect(RunStepRequestSchema.parse(sentBody(calls))).toEqual(req);
    expect(res).toEqual({ ok: true, data: { finding } });
  });

  it("POST /api/scans/finalize", async () => {
    const { fn, calls } = fakeFetch(jsonResponse({ scan: L0.scan }));
    const req = {
      scan: { id: L0.scan.id, level: L0.scan.level, kind: L0.scan.kind, createdAt: L0.scan.createdAt },
      findings: L0.findings,
    };
    const res = await finalizeScan(req, { fetchImpl: fn });
    expect(calls[0].url).toBe("/api/scans/finalize");
    expect(FinalizeScanRequestSchema.parse(sentBody(calls))).toEqual(req);
    expect(res.ok && res.data.scan.grade).toBe("F");
  });

  it("POST /api/fix", async () => {
    const { fn, calls } = fakeFetch(jsonResponse({ fix: FIX1 }));
    const req = { target: { mode: "demo" as const }, findings: L0.findings, level: 1 as const };
    const res = await createFix(req, { fetchImpl: fn });
    expect(calls[0].url).toBe("/api/fix");
    expect(CreateFixRequestSchema.parse(sentBody(calls))).toEqual(req);
    expect(res.ok && res.data.fix.outputGuard.enabled).toBe(false);
  });

  it("POST /api/demo-bot/chat", async () => {
    const { fn, calls } = fakeFetch(jsonResponse({ reply: "Ji, lawn suits available hain." }));
    const req = { messages: [{ role: "user" as const, content: "lawn suit hai?" }] };
    const res = await demoChat(req, { fetchImpl: fn });
    expect(calls[0].url).toBe("/api/demo-bot/chat");
    expect(DemoChatRequestSchema.parse(sentBody(calls))).toEqual(req);
    expect(res).toEqual({ ok: true, data: { reply: "Ji, lawn suits available hain." } });
  });

  it("an invalid request is refused before anything is sent", async () => {
    const { fn, calls } = fakeFetch(jsonResponse({}));
    const res = await planScan(
      // level 1 without a fix fails the shared schema
      { target: { mode: "demo" }, level: 1, kind: "retest", size: "quick" },
      { fetchImpl: fn },
    );
    expect(calls).toHaveLength(0);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.kind).toBe("invalid_input");
  });
});

describe("api-client: error mapping", () => {
  const chat = (res: Response | (() => Response | Promise<Response>)) =>
    demoChat({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl: fakeFetch(res).fn });

  it("429 rate_limited keeps Retry-After and says so in plain language", async () => {
    const res = await chat(
      jsonResponse({ error: { code: "rate_limited", message: "Too many requests" } }, 429, { "retry-after": "7" }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatchObject({ kind: "rate_limited", status: 429, retryAfterSec: 7 });
    expect(res.error.message).toMatch(/Too many requests to Bizvyra/);
    expect(res.error.message).toMatch(/7 s/);
  });

  it("429 usage_limit shows the server's free-tier message", async () => {
    const message = "Free tier limit reached: 3 scans per day. Please try again tomorrow.";
    const res = await chat(jsonResponse({ error: { code: "usage_limit", message } }, 429));
    expect(!res.ok && res.error).toMatchObject({ kind: "usage_limit", status: 429, message });
  });

  it("500 with a non-JSON body becomes a server error", async () => {
    const res = await chat(new Response("<html>Internal Server Error</html>", { status: 500 }));
    expect(!res.ok && res.error).toMatchObject({ kind: "server", status: 500 });
    expect(!res.ok && res.error.message).not.toMatch(/html/i);
  });

  it("502 upstream_error keeps the route's message", async () => {
    const message = "The demo bot is unavailable right now. Please try again.";
    const res = await chat(jsonResponse({ error: { code: "upstream_error", message } }, 502));
    expect(!res.ok && res.error).toMatchObject({ kind: "upstream", status: 502, message });
  });

  it("400 invalid_input names the first issue", async () => {
    const res = await chat(
      jsonResponse(
        { error: { code: "invalid_input", message: "Invalid input", issues: [{ path: "messages.0.content", message: "Too big" }] } },
        400,
      ),
    );
    expect(!res.ok && res.error.kind).toBe("invalid_input");
    expect(!res.ok && res.error.message).toMatch(/messages\.0\.content: Too big/);
  });

  it("invalid JSON on a 200 becomes invalid_response, never a crash", async () => {
    const res = await chat(new Response("{not json", { status: 200 }));
    expect(!res.ok && res.error).toMatchObject({ kind: "invalid_response", status: 200 });
  });

  it("a 200 body that does not match the schema becomes invalid_response", async () => {
    const res = await chat(jsonResponse({ answer: "wrong shape" }));
    expect(!res.ok && res.error).toMatchObject({ kind: "invalid_response", status: 200 });
  });

  it("a network failure becomes a network error", async () => {
    const res = await chat(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(!res.ok && res.error).toMatchObject({ kind: "network", status: null });
  });

  it("an aborted request becomes cancelled; a slow one becomes timeout", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const controller = new AbortController();
    const pending = demoChat({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl: hang, signal: controller.signal });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, error: { kind: "cancelled" } });

    const slow = await demoChat({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl: hang, timeoutMs: 10 });
    expect(slow).toMatchObject({ ok: false, error: { kind: "timeout" } });
  });

  it("errorFromResponse parses an HTTP-date Retry-After", () => {
    const date = new Date(Date.now() + 5000).toUTCString();
    const err = errorFromResponse(429, "", date);
    expect(err.kind).toBe("rate_limited");
    expect(err.retryAfterSec).toBeGreaterThanOrEqual(3);
    expect(err.retryAfterSec).toBeLessThanOrEqual(6);
  });

  it("postJson never throws, even when fetch throws synchronously", async () => {
    const boom: FetchLike = () => {
      throw new Error("boom");
    };
    const res = await postJson(
      "/api/demo-bot/chat",
      { messages: [{ role: "user", content: "hi" }] },
      { request: DemoChatRequestSchema, response: DemoChatRequestSchema },
      { fetchImpl: boom },
    );
    expect(res).toMatchObject({ ok: false, error: { kind: "network" } });
  });
});

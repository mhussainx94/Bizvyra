import {
  CreateFixRequestSchema,
  CreateFixResponseSchema,
  CreateScanRequestSchema,
  CreateScanResponseSchema,
  DemoChatRequestSchema,
  DemoChatResponseSchema,
  FinalizeScanRequestSchema,
  FinalizeScanResponseSchema,
  RunStepRequestSchema,
  RunStepResponseSchema,
  type CreateFixRequest,
  type CreateFixResponse,
  type CreateScanRequest,
  type CreateScanResponse,
  type DemoChatRequest,
  type DemoChatResponse,
  type FinalizeScanRequest,
  type FinalizeScanResponse,
  type Level,
  type RunStepRequest,
  type RunStepResponse,
  type Step,
} from "@/lib/types";
import { postJson, type ApiResult, type PostOptions, type UiError } from "@/lib/ui/http";
import type { ScanClient } from "@/lib/ui/scan-runner";
import type { SampleRun } from "@/lib/ui/sample-run";

export type { ApiResult, UiError } from "@/lib/ui/http";

/**
 * Browser client for the Bizvyra API (docs/api-contract.md v2). Every request and response is checked against the
 * zod schemas in src/lib/types; failures come back as a typed UiError (see src/lib/ui/http.ts), never thrown.
 *
 * Mock mode (NEXT_PUBLIC_USE_MOCKS=true at build time) answers from the static sample run instead of the API,
 * for UI work without an API key. The page then says it shows sample data.
 */
export const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === "true";

type CallOptions = Pick<PostOptions, "signal" | "fetchImpl" | "timeoutMs">;

export function planScan(req: CreateScanRequest, opts: CallOptions = {}): Promise<ApiResult<CreateScanResponse>> {
  if (USE_MOCKS) return mock((s) => mockPlan(s, req.level));
  return postJson("/api/scans", req, { request: CreateScanRequestSchema, response: CreateScanResponseSchema }, opts);
}

export function runStep(req: RunStepRequest, opts: CallOptions = {}): Promise<ApiResult<RunStepResponse>> {
  if (USE_MOCKS) return mock((s) => mockStep(s, req.level, req.step.checkId), opts.signal);
  return postJson("/api/scans/step", req, { request: RunStepRequestSchema, response: RunStepResponseSchema }, opts);
}

export function finalizeScan(
  req: FinalizeScanRequest,
  opts: CallOptions = {},
): Promise<ApiResult<FinalizeScanResponse>> {
  if (USE_MOCKS) return mock((s) => ({ scan: runAt(s, req.scan.level).scan }));
  return postJson(
    "/api/scans/finalize",
    req,
    { request: FinalizeScanRequestSchema, response: FinalizeScanResponseSchema },
    opts,
  );
}

export function createFix(req: CreateFixRequest, opts: CallOptions = {}): Promise<ApiResult<CreateFixResponse>> {
  if (USE_MOCKS) return mock((s) => ({ fix: s.fixes[req.level === 1 ? "1" : "2"] }));
  return postJson("/api/fix", req, { request: CreateFixRequestSchema, response: CreateFixResponseSchema }, opts);
}

export function demoChat(req: DemoChatRequest, opts: CallOptions = {}): Promise<ApiResult<DemoChatResponse>> {
  if (USE_MOCKS) {
    return mock(() => ({
      reply: "(Mock mode) This is a sample reply. Build without NEXT_PUBLIC_USE_MOCKS to chat with the real demo bot.",
    }));
  }
  return postJson(
    "/api/demo-bot/chat",
    req,
    { request: DemoChatRequestSchema, response: DemoChatResponseSchema },
    opts,
  );
}

/** The scan routes as a ScanClient for runScan(). */
export const apiScanClient: ScanClient = { planScan, runStep, finalizeScan };

/* ------------------------------------------------------------ mock mode */

const MOCK_DELAY_MS = 350;

function runAt(sample: SampleRun, level: Level) {
  return sample.runs.find((r) => r.level === level) ?? sample.runs[0];
}

function mockPlan(sample: SampleRun, level: Level): CreateScanResponse {
  const run = runAt(sample, level);
  const steps: Step[] = run.findings.map((f, index) => ({
    id: f.checkId,
    index,
    module: f.module,
    checkId: f.checkId,
    level,
    ...(f.lang ? { lang: f.lang } : {}),
    ...(f.intent ? { intent: f.intent } : {}),
    ...(f.technique ? { technique: f.technique } : {}),
  }));
  return {
    scan: { ...run.scan, status: "running", score: null, grade: null, summary: null, finishedAt: null },
    steps,
    concurrency: 3,
  };
}

function mockStep(sample: SampleRun, level: Level, checkId: string): RunStepResponse | UiError {
  const finding = runAt(sample, level).findings.find((f) => f.checkId === checkId);
  if (!finding) return { kind: "invalid_input", status: 400, message: "Unknown check (mock mode)." };
  return { finding };
}

/** Loaded on first use only, so live builds do not ship the sample fixture with the scan page. */
async function loadSample(): Promise<SampleRun> {
  return (await import("@/lib/ui/sample-run")).SAMPLE_RUN;
}

async function mock<T>(make: (sample: SampleRun) => T | UiError, signal?: AbortSignal): Promise<ApiResult<T>> {
  const sample = await loadSample();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const value = make(sample);
      if (value && typeof value === "object" && "kind" in value && "message" in value) {
        resolve({ ok: false, error: value as UiError });
      } else {
        resolve({ ok: true, data: value as T });
      }
    }, MOCK_DELAY_MS);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve({ ok: false, error: { kind: "cancelled", status: null, message: "Cancelled." } });
      },
      { once: true },
    );
  });
}

import {
  FindingSchema,
  LIMITS,
  type ChatbotFixContent,
  type CreateScanRequest,
  type CreateScanResponse,
  type FinalizeScanRequest,
  type FinalizeScanResponse,
  type Finding,
  type RunStepRequest,
  type RunStepResponse,
  type Scan,
  type Step,
} from "@/lib/types";
import { isRetryable, type ApiResult, type UiError } from "./http";

/**
 * Client-driven scan (docs/api-contract.md v2): plan, then run the steps from the browser with the `concurrency`
 * the plan returns, then finalize. Cancelling stops issuing new steps and aborts the ones in flight.
 * A step whose HTTP request fails (even after retries) is recorded as an `error` finding, never as a pass.
 */

export interface ScanClient {
  planScan(req: CreateScanRequest, opts?: { signal?: AbortSignal }): Promise<ApiResult<CreateScanResponse>>;
  runStep(req: RunStepRequest, opts?: { signal?: AbortSignal }): Promise<ApiResult<RunStepResponse>>;
  finalizeScan(req: FinalizeScanRequest, opts?: { signal?: AbortSignal }): Promise<ApiResult<FinalizeScanResponse>>;
}

export interface ScanCounts {
  breaches: number;
  passes: number;
  errors: number;
  skipped: number;
}

export interface ScanProgress extends ScanCounts {
  total: number;
  done: number;
  /** Steps whose request is in flight right now. */
  inFlight: Step[];
  /** Findings so far, in the order they arrived. */
  findings: Finding[];
  /** Set while waiting before a retry (rate limited). */
  waitingSec: number | null;
}

export type ScanOutcome =
  | { status: "done"; scan: Scan; findings: Finding[] }
  | { status: "cancelled"; done: number; total: number }
  | { status: "plan_failed"; error: UiError }
  /** The steps ran but scoring failed: the UI can retry finalize with these findings. */
  | { status: "finalize_failed"; error: UiError; plannedScan: Scan; findings: Finding[] };

export interface RunScanOptions {
  client: ScanClient;
  request: CreateScanRequest;
  signal: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
  /** Retries per step for retryable HTTP failures (rate limited, network, 5xx). Default 2. */
  stepRetries?: number;
  /** Injected in tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const MAX_WAIT_MS = 10_000;

export function countFindings(findings: readonly Finding[]): ScanCounts {
  const counts: ScanCounts = { breaches: 0, passes: 0, errors: 0, skipped: 0 };
  for (const f of findings) {
    if (f.status === "breach") counts.breaches++;
    else if (f.status === "pass") counts.passes++;
    else if (f.status === "error") counts.errors++;
    else counts.skipped++;
  }
  return counts;
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** RFC 4122 v4 id. crypto.randomUUID needs a secure context; getRandomValues does not. */
export function uuidV4(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The Finding recorded when the step request itself failed (the server never judged the attack).
 * It is an `error`: never counted as a pass, and excluded from the score like every error.
 */
export function clientErrorFinding(scanId: string, step: Step, error: UiError): Finding {
  const evidence = `This test did not run: ${error.message} Counted as an error, not as a pass.`;
  return FindingSchema.parse({
    id: uuidV4(),
    scanId,
    module: step.module,
    checkId: step.checkId,
    title_en: "Test could not run",
    title_ur: "یہ ٹیسٹ نہیں چل سکا",
    status: "error",
    // Errors carry no weight in scoring; the step does not tell the browser the attack's severity.
    severity: 1,
    standard: "n/a",
    evidence: evidence.slice(0, LIMITS.evidenceChars),
    judgedBy: "none",
    businessImpact_en: "Not tested, so this risk is unknown. Run the inspection again to check it.",
    businessImpact_ur: "یہ ٹیسٹ نہیں ہو سکا، اس لیے یہ خطرہ ابھی نامعلوم ہے۔ دوبارہ معائنہ کریں۔",
    ...(step.lang ? { lang: step.lang } : {}),
    ...(step.technique ? { technique: step.technique } : {}),
    ...(step.intent ? { intent: step.intent } : {}),
    latencyMs: 0,
  });
}

function waitMs(error: UiError, attempt: number): number {
  if (error.retryAfterSec !== undefined) return Math.min(error.retryAfterSec * 1000, MAX_WAIT_MS);
  return Math.min(2000 * (attempt + 1), MAX_WAIT_MS);
}

/** Scores a finished scan, retrying once on a retryable failure. */
export async function finalizeFindings(
  client: ScanClient,
  plannedScan: Scan,
  findings: Finding[],
  signal?: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = abortableSleep,
): Promise<ApiResult<FinalizeScanResponse>> {
  const req: FinalizeScanRequest = {
    scan: { id: plannedScan.id, level: plannedScan.level, kind: plannedScan.kind, createdAt: plannedScan.createdAt },
    findings,
  };
  const first = await client.finalizeScan(req, { signal });
  if (first.ok || !isRetryable(first.error)) return first;
  await sleep(waitMs(first.error, 0), signal ?? new AbortController().signal);
  if (signal?.aborted) return first;
  return client.finalizeScan(req, { signal });
}

export async function runScan(options: RunScanOptions): Promise<ScanOutcome> {
  const { client, request, signal } = options;
  const retries = options.stepRetries ?? 2;
  const sleep = options.sleep ?? abortableSleep;

  const plan = await client.planScan(request, { signal });
  if (signal.aborted) return { status: "cancelled", done: 0, total: 0 };
  if (!plan.ok) return { status: "plan_failed", error: plan.error };

  const { scan, steps } = plan.data;
  if (steps.length === 0) {
    return {
      status: "plan_failed",
      error: { kind: "invalid_response", status: null, message: "The server planned no attacks for this scan." },
    };
  }
  const concurrency = Math.max(1, Math.min(plan.data.concurrency, steps.length || 1));
  const fix: ChatbotFixContent | undefined = request.fix;
  const results: (Finding | null)[] = new Array(steps.length).fill(null);
  const arrived: Finding[] = [];
  const inFlight = new Set<Step>();
  let waitingSec: number | null = null;

  const emit = () =>
    options.onProgress?.({
      total: steps.length,
      done: arrived.length,
      ...countFindings(arrived),
      inFlight: [...inFlight],
      findings: [...arrived],
      waitingSec,
    });

  async function runOne(step: Step): Promise<Finding | null> {
    const req: RunStepRequest = {
      scanId: scan.id,
      level: request.level,
      step: { checkId: step.checkId },
      target: request.target,
      ...(fix ? { fix } : {}),
    };
    for (let attempt = 0; ; attempt++) {
      const res = await client.runStep(req, { signal });
      if (signal.aborted) return null;
      if (res.ok) return res.data.finding;
      if (res.error.kind === "cancelled") return null;
      if (!isRetryable(res.error) || attempt >= retries) return clientErrorFinding(scan.id, step, res.error);
      const ms = waitMs(res.error, attempt);
      waitingSec = Math.ceil(ms / 1000);
      emit();
      await sleep(ms, signal);
      waitingSec = null;
      if (signal.aborted) return null;
    }
  }

  let next = 0;
  async function lane(): Promise<void> {
    while (!signal.aborted && next < steps.length) {
      const i = next++;
      const step = steps[i];
      inFlight.add(step);
      emit();
      const finding = await runOne(step);
      inFlight.delete(step);
      if (finding) {
        results[i] = finding;
        arrived.push(finding);
      }
      emit();
    }
  }

  emit();
  await Promise.all(Array.from({ length: concurrency }, lane));
  if (signal.aborted) return { status: "cancelled", done: arrived.length, total: steps.length };

  const findings = results.filter((f): f is Finding => f !== null);
  const finalized = await finalizeFindings(client, scan, findings, signal, sleep);
  if (signal.aborted) return { status: "cancelled", done: arrived.length, total: steps.length };
  if (!finalized.ok) return { status: "finalize_failed", error: finalized.error, plannedScan: scan, findings };
  return { status: "done", scan: finalized.data.scan, findings };
}

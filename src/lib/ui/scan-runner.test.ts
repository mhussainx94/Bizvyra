import { describe, expect, it } from "vitest";
import { FindingSchema, type CreateScanResponse, type Finding, type RunStepRequest } from "@/lib/types";
import type { ApiResult, UiError } from "./http";
import { clientErrorFinding, runScan, type ScanClient, type ScanProgress } from "./scan-runner";
import { SAMPLE_RUN } from "./sample-run";

const L0 = SAMPLE_RUN.runs[0];
const FIX1 = SAMPLE_RUN.fixes["1"];

function plan(stepCount: number, concurrency: number): CreateScanResponse {
  const findings = L0.findings.slice(0, stepCount);
  return {
    scan: { ...L0.scan, status: "running", score: null, grade: null, summary: null, finishedAt: null },
    steps: findings.map((f, index) => ({
      id: f.checkId,
      index,
      module: "chatbot",
      checkId: f.checkId,
      level: 0,
      lang: f.lang,
      intent: f.intent,
      technique: f.technique,
    })),
    concurrency,
  };
}

function findingFor(checkId: string): Finding {
  const f = L0.findings.find((x) => x.checkId === checkId);
  if (!f) throw new Error(checkId);
  return f;
}

interface Deferred {
  req: RunStepRequest;
  resolve: (r: ApiResult<{ finding: Finding }>) => void;
}

/** A fake client whose steps resolve only when the test says so, to observe concurrency. */
function controlledClient(p: CreateScanResponse) {
  const pending: Deferred[] = [];
  const stepCalls: RunStepRequest[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const finalizeCalls: { findings: Finding[] }[] = [];
  const client: ScanClient = {
    planScan: async () => ({ ok: true, data: p }),
    runStep: (req, opts) =>
      new Promise((resolve) => {
        stepCalls.push(req);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const done = (r: ApiResult<{ finding: Finding }>) => {
          inFlight--;
          resolve(r);
        };
        opts?.signal?.addEventListener("abort", () =>
          done({ ok: false, error: { kind: "cancelled", status: null, message: "Cancelled." } }),
        );
        pending.push({ req, resolve: done });
      }),
    finalizeScan: async (req) => {
      finalizeCalls.push({ findings: req.findings });
      return { ok: true, data: { scan: L0.scan } };
    },
  };
  return {
    client,
    pending,
    stepCalls,
    finalizeCalls,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("runScan", () => {
  it("never runs more steps at once than the plan's concurrency, and finalizes in step order", async () => {
    const p = plan(7, 2);
    const c = controlledClient(p);
    const progress: ScanProgress[] = [];
    const run = runScan({
      client: c.client,
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
      onProgress: (x) => progress.push(x),
    });

    // Resolve the steps out of order, a few at a time.
    while (c.stepCalls.length < 7 || c.pending.length > 0) {
      await tick();
      expect(c.pending.length).toBeLessThanOrEqual(2);
      const next = c.pending.pop();
      if (next) next.resolve({ ok: true, data: { finding: findingFor(next.req.step.checkId) } });
    }
    const outcome = await run;

    expect(c.maxInFlight).toBe(2);
    expect(c.stepCalls).toHaveLength(7);
    expect(outcome.status).toBe("done");
    expect(c.finalizeCalls).toHaveLength(1);
    expect(c.finalizeCalls[0].findings.map((f) => f.checkId)).toEqual(p.steps.map((s) => s.checkId));
    const last = progress[progress.length - 1];
    expect(last.done).toBe(7);
    expect(last.breaches + last.passes + last.errors + last.skipped).toBe(7);
    expect(Math.max(...progress.map((x) => x.inFlight.length))).toBe(2);
  });

  it("uses concurrency 1 when the plan says 1", async () => {
    const c = controlledClient(plan(4, 1));
    const run = runScan({
      client: c.client,
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
    });
    while (c.stepCalls.length < 4 || c.pending.length > 0) {
      await tick();
      const next = c.pending.shift();
      if (next) next.resolve({ ok: true, data: { finding: findingFor(next.req.step.checkId) } });
    }
    expect((await run).status).toBe("done");
    expect(c.maxInFlight).toBe(1);
  });

  it("sends the fix and level with every step of a retest", async () => {
    const c = controlledClient({ ...plan(3, 3) });
    const run = runScan({
      client: c.client,
      request: { target: { mode: "demo" }, level: 1, kind: "retest", size: "quick", fix: FIX1 },
      signal: new AbortController().signal,
    });
    while (c.stepCalls.length < 3 || c.pending.length > 0) {
      await tick();
      const next = c.pending.shift();
      if (next) next.resolve({ ok: true, data: { finding: findingFor(next.req.step.checkId) } });
    }
    await run;
    for (const req of c.stepCalls) {
      expect(req.level).toBe(1);
      expect(req.fix).toEqual(FIX1);
      expect(req.scanId).toBe(L0.scan.id);
    }
  });

  it("cancel stops issuing new steps, aborts the ones in flight and does not finalize", async () => {
    const c = controlledClient(plan(10, 2));
    const controller = new AbortController();
    const run = runScan({
      client: c.client,
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: controller.signal,
    });
    await tick();
    // Finish one step, let the next one start, then cancel.
    const first = c.pending.shift()!;
    first.resolve({ ok: true, data: { finding: findingFor(first.req.step.checkId) } });
    await tick();
    const startedBeforeCancel = c.stepCalls.length;
    expect(startedBeforeCancel).toBe(3);
    controller.abort();
    const outcome = await run;
    await tick();

    expect(outcome).toEqual({ status: "cancelled", done: 1, total: 10 });
    expect(c.stepCalls).toHaveLength(startedBeforeCancel);
    expect(c.finalizeCalls).toHaveLength(0);
  });

  it("retries a rate-limited step after the Retry-After wait, then records it", async () => {
    const p = plan(2, 1);
    let calls = 0;
    const waits: number[] = [];
    const client: ScanClient = {
      planScan: async () => ({ ok: true, data: p }),
      runStep: async (req) => {
        calls++;
        if (calls === 1) {
          return { ok: false, error: { kind: "rate_limited", status: 429, message: "slow down", retryAfterSec: 4 } };
        }
        return { ok: true, data: { finding: findingFor(req.step.checkId) } };
      },
      finalizeScan: async () => ({ ok: true, data: { scan: L0.scan } }),
    };
    const outcome = await runScan({
      client,
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([4000]);
    expect(calls).toBe(3);
    expect(outcome.status === "done" && outcome.findings.map((f) => f.status)).toEqual(
      p.steps.map((s) => findingFor(s.checkId).status),
    );
  });

  it("a step that keeps failing becomes an error finding (never a pass) and the scan still finalizes", async () => {
    const p = plan(3, 3);
    const err: UiError = { kind: "server", status: 500, message: "The Bizvyra server had a problem (HTTP 500)." };
    let finalized: Finding[] = [];
    const client: ScanClient = {
      planScan: async () => ({ ok: true, data: p }),
      runStep: async (req) =>
        req.step.checkId === p.steps[1].checkId
          ? { ok: false, error: err }
          : { ok: true, data: { finding: findingFor(req.step.checkId) } },
      finalizeScan: async (req) => {
        finalized = req.findings;
        return { ok: true, data: { scan: L0.scan } };
      },
    };
    const outcome = await runScan({
      client,
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
      stepRetries: 2,
      sleep: async () => {},
    });
    expect(outcome.status).toBe("done");
    expect(finalized).toHaveLength(3);
    const failed = finalized[1];
    expect(FindingSchema.parse(failed).status).toBe("error");
    expect(failed.judgedBy).toBe("none");
    expect(failed.scanId).toBe(p.scan.id);
    expect(failed.checkId).toBe(p.steps[1].checkId);
    expect(failed.evidence).toMatch(/HTTP 500.*Counted as an error, not as a pass\./);
  });

  it("returns plan_failed with the typed error when planning fails", async () => {
    const error: UiError = { kind: "usage_limit", status: 429, message: "Free tier limit reached" };
    const outcome = await runScan({
      client: {
        planScan: async () => ({ ok: false, error }),
        runStep: async () => {
          throw new Error("must not run");
        },
        finalizeScan: async () => {
          throw new Error("must not run");
        },
      },
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
    });
    expect(outcome).toEqual({ status: "plan_failed", error });
  });

  it("returns finalize_failed with the findings so scoring can be retried", async () => {
    const p = plan(2, 2);
    const error: UiError = { kind: "invalid_input", status: 400, message: "bad" };
    const outcome = await runScan({
      client: {
        planScan: async () => ({ ok: true, data: p }),
        runStep: async (req) => ({ ok: true, data: { finding: findingFor(req.step.checkId) } }),
        finalizeScan: async () => ({ ok: false, error }),
      },
      request: { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" },
      signal: new AbortController().signal,
    });
    expect(outcome.status).toBe("finalize_failed");
    expect(outcome.status === "finalize_failed" && outcome.findings).toHaveLength(2);
  });

  it("clientErrorFinding is schema-valid without crypto.randomUUID", () => {
    const step = plan(1, 1).steps[0];
    const f = clientErrorFinding(L0.scan.id, step, { kind: "network", status: null, message: "Could not reach." });
    expect(FindingSchema.parse(f).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(/[؀-ۿ]/.test(f.title_ur)).toBe(true);
  });
});

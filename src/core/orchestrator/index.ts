import { randomUUID } from "node:crypto";
import { getModule } from "@/core/registry";
import { scoreFindings } from "@/core/scoring";
import type {
  CreateScanRequest,
  CreateScanResponse,
  Finding,
  FinalizeScanRequest,
  ModuleId,
  RunStepRequest,
  Scan,
} from "@/lib/types";

/**
 * Stateless scan orchestrator (docs/api-contract.md v2): plan, run one step, finalize.
 * The browser holds the target, the steps and the findings; nothing is stored here.
 */

/** Default steps in flight per scan; SCAN_CONCURRENCY (integer 1–5) overrides it. */
export const STEP_CONCURRENCY = 3;
export const SCAN_CONCURRENCY_MIN = 1;
export const SCAN_CONCURRENCY_MAX = 5;

/** SCAN_CONCURRENCY read on each call: an integer 1–5, otherwise (unset, blank, invalid) the default 3. */
export function scanConcurrency(raw: string | undefined = process.env.SCAN_CONCURRENCY): number {
  const value = raw?.trim() ?? "";
  if (!/^\d+$/.test(value)) return STEP_CONCURRENCY;
  const n = Number(value);
  return n >= SCAN_CONCURRENCY_MIN && n <= SCAN_CONCURRENCY_MAX ? n : STEP_CONCURRENCY;
}

/** TargetInput (v2) describes a chatbot; more modules add their own target inputs. */
const TARGET_MODULE: ModuleId = "chatbot";

function moduleFor(id: ModuleId) {
  const mod = getModule(id);
  if (!mod) throw new Error(`module not registered: ${id}`);
  return mod;
}

export function planScan(input: CreateScanRequest, now: Date = new Date()): CreateScanResponse {
  const mod = moduleFor(TARGET_MODULE);
  const scan: Scan = {
    id: randomUUID(),
    targetId: null,
    module: mod.id,
    kind: input.kind,
    level: input.level,
    status: "running",
    score: null,
    grade: null,
    summary: null,
    createdAt: now.toISOString(),
    finishedAt: null,
  };
  const steps = mod.plan({ target: input.target, level: input.level, size: input.size });
  return { scan, steps, concurrency: scanConcurrency() };
}

export type StepOutcome = { ok: true; finding: Finding } | { ok: false; reason: "unknown_check" };

export async function runScanStep(input: RunStepRequest): Promise<StepOutcome> {
  const mod = moduleFor(TARGET_MODULE);
  if (!mod.hasCheck(input.step.checkId)) return { ok: false, reason: "unknown_check" };
  const finding = await mod.runStep({
    scanId: input.scanId,
    level: input.level,
    checkId: input.step.checkId,
    target: input.target,
    fix: input.fix,
  });
  return { ok: true, finding };
}

/** Pure computation: scores the findings and returns the finished scan. */
export function finalizeScan(input: FinalizeScanRequest, now: Date = new Date()): Scan {
  const { score, grade, summary } = scoreFindings(input.findings);
  return {
    id: input.scan.id,
    targetId: null,
    module: input.findings[0]?.module ?? TARGET_MODULE,
    kind: input.scan.kind,
    level: input.scan.level,
    status: "done",
    score,
    grade,
    summary,
    createdAt: input.scan.createdAt,
    finishedAt: now.toISOString(),
  };
}

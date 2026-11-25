/**
 * Typed mock responses in the v2 shapes of docs/api-contract.md, so the UI can work without an API key.
 * The scan routes are real since T002; /api/targets, /api/leads and /api/reports/[slug] still use these mocks.
 * Shared folder: append only.
 */
import { randomUUID } from "node:crypto";
import type {
  CreateLeadResponse,
  CreateScanResponse,
  CreateTargetRequest,
  FinalizeScanResponse,
  Level,
  ReportView,
  RunStepResponse,
  TargetPublic,
} from "@/lib/types";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";
import { MOCK_SHARE_SLUG, MOCK_TARGET_ID, MOCK_TARGET_NAME, mockFindings, mockScan, mockSteps } from "./chatbot-demo";

export * from "./chatbot-demo";

export const MOCK_STEP_CONCURRENCY = 3;

export function mockCreateTarget(input: CreateTargetRequest, now: Date = new Date()): TargetPublic {
  const isDemo = input.config.mode === "demo";
  return {
    id: isDemo ? MOCK_TARGET_ID : randomUUID(),
    module: "chatbot",
    name: input.name,
    mode: input.config.mode,
    protectedAssetCount: isDemo ? DEMO_PROTECTED_ASSETS.length : (input.protectedAssets ?? []).length,
    createdAt: now.toISOString(),
  };
}

/** POST /api/scans response for the mock scan of this level: the plan, not yet run. */
export function mockPlan(level: Level): CreateScanResponse {
  const scan = mockScan(level);
  return {
    scan: { ...scan, status: "running", score: null, grade: null, summary: null, finishedAt: null },
    steps: mockSteps(level),
    concurrency: MOCK_STEP_CONCURRENCY,
  };
}

/** POST /api/scans/step response for one step of the mock scan of this level, or null when unknown. */
export function mockStep(level: Level, checkId: string): RunStepResponse | null {
  const finding = mockFindings(level).find((f) => f.checkId === checkId);
  return finding ? { finding } : null;
}

/** POST /api/scans/finalize response for the mock scan of this level. */
export function mockFinalize(level: Level): FinalizeScanResponse {
  return { scan: mockScan(level) };
}

export function mockCreateLead(): CreateLeadResponse {
  return { ok: true, id: randomUUID() };
}

export function mockGetReport(slug: string): ReportView | null {
  if (slug !== MOCK_SHARE_SLUG) return null;
  const levels = [0, 1, 2] as const;
  const scans = levels.map((l) => mockScan(l));
  const scores = scans.map((s) => s.score ?? 0);
  return {
    shareSlug: MOCK_SHARE_SLUG,
    createdAt: "2026-11-25T09:07:30.000Z",
    expiresAt: "2027-02-23T09:07:30.000Z",
    target: { name: MOCK_TARGET_NAME, module: "chatbot" },
    bizvyraScore: scores[scores.length - 1],
    scans,
    findings: levels.flatMap((l) => mockFindings(l)),
  };
}

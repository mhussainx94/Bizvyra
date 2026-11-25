/**
 * Typed mock responses for every API route (T001). Replaced route by route by T002/T003.
 * Shared folder: append only.
 */
import { randomUUID } from "node:crypto";
import type {
  CreateLeadResponse,
  CreateScanRequest,
  CreateScanResponse,
  CreateTargetRequest,
  FinalizeScanResponse,
  Finding,
  Fix,
  FixLevel,
  Level,
  ReportView,
  TargetPublic,
} from "@/lib/types";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";
import {
  MOCK_SCAN_IDS,
  MOCK_SHARE_SLUG,
  MOCK_TARGET_ID,
  MOCK_TARGET_NAME,
  mockFindings,
  mockFix,
  mockScan,
  mockSteps,
} from "./chatbot-demo";

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

/** The plan for a new scan: the mock scan for the requested level, not yet run. */
export function mockCreateScan(input: CreateScanRequest, now: Date = new Date()): CreateScanResponse {
  const scan = mockScan(input.level, input.targetId);
  return {
    scan: {
      ...scan,
      kind: input.kind,
      status: "running",
      score: null,
      grade: null,
      summary: null,
      createdAt: now.toISOString(),
      finishedAt: null,
    },
    steps: mockSteps(input.level),
    concurrency: MOCK_STEP_CONCURRENCY,
  };
}

function levelOfScan(scanId: string): Level | null {
  for (const level of [0, 1, 2] as const) {
    if (MOCK_SCAN_IDS[level] === scanId) return level;
  }
  return null;
}

export type MockStepResult = { ok: true; finding: Finding } | { ok: false; reason: "scan_not_found" | "step_not_found" };

export function mockRunStep(scanId: string, index: number): MockStepResult {
  const level = levelOfScan(scanId);
  if (level === null) return { ok: false, reason: "scan_not_found" };
  const finding = mockFindings(level)[index];
  return finding ? { ok: true, finding } : { ok: false, reason: "step_not_found" };
}

export function mockFinalizeScan(scanId: string): FinalizeScanResponse | null {
  const level = levelOfScan(scanId);
  if (level === null) return null;
  return { scan: mockScan(level), shareSlug: MOCK_SHARE_SLUG };
}

export function mockCreateFix(targetId: string, level: FixLevel): Fix {
  return mockFix(targetId, level);
}

export function mockCreateLead(): CreateLeadResponse {
  return { ok: true, id: randomUUID() };
}

export function mockGetReport(slug: string): ReportView | null {
  if (slug !== MOCK_SHARE_SLUG) return null;
  const levels = [0, 1, 2] as const;
  return {
    shareSlug: MOCK_SHARE_SLUG,
    createdAt: "2026-11-25T09:07:30.000Z",
    expiresAt: "2027-02-23T09:07:30.000Z",
    target: { name: MOCK_TARGET_NAME, module: "chatbot" },
    bizvyraScore: 86,
    scans: levels.map((l) => mockScan(l)),
    findings: levels.flatMap((l) => mockFindings(l)),
  };
}

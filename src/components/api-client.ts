import type {
  ChatMessage,
  ChatbotFixContent,
  DemoChatResponse,
  Finding,
  FixLevel,
  Level,
  Scan,
  ScanKind,
  Step,
} from "@/lib/types";
import {
  buildMockFinalScan,
  buildMockFinding,
  buildMockFix,
  buildMockSteps,
  generateMockDemoReply,
} from "./mock-data";

/** Toggle between built-in realistic mock data (~400 ms/step) and live /api routes. */
export const USE_MOCKS = true;

export type ScanSize = "quick" | "full";

export type TargetInput =
  | { mode: "demo" }
  | {
      mode: "prompt";
      name: string;
      systemPrompt: string;
      protectedAssets: string[];
    };

export interface PlanScanRequest {
  target: TargetInput;
  level: Level;
  kind: ScanKind;
  size: ScanSize;
  fix?: ChatbotFixContent;
}

export interface PlanScanResponse {
  scan: Scan;
  steps: Step[];
  concurrency: number;
}

export interface RunStepRequest {
  scanId: string;
  level: Level;
  step: { checkId: string };
  target: TargetInput;
  fix?: ChatbotFixContent;
}

export interface RunStepResponse {
  finding: Finding;
}

export interface FinalizeScanRequest {
  scan: {
    id: string;
    level: Level;
    kind: ScanKind;
    createdAt: string;
  };
  findings: Finding[];
}

export interface FinalizeScanResponse {
  scan: Scan;
}

export interface CreateFixRequest {
  target: TargetInput;
  findings: Finding[];
  level: FixLevel;
}

export interface CreateFixResponse {
  fix: ChatbotFixContent;
}

export interface DemoChatRequest {
  messages: ChatMessage[];
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "api_error") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

const STEP_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Tracks step index lookup in mock mode so each step returns deterministic mock data
const mockStepIndexMap = new Map<string, Map<string, { index: number; targetName?: string }>>();

async function postJson<TResponse>(path: string, payload: unknown): Promise<TResponse> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = "api_error";
    try {
      const body = (await res.json()) as { error?: { message?: string; code?: string } };
      if (body?.error?.message) message = body.error.message;
      if (body?.error?.code) code = body.error.code;
    } catch {
      // Ignore malformed error body
    }
    throw new ApiClientError(message, res.status, code);
  }

  return (await res.json()) as TResponse;
}

export async function planScan(input: PlanScanRequest): Promise<PlanScanResponse> {
  if (!USE_MOCKS) {
    return postJson<PlanScanResponse>("/api/scans", input);
  }

  await delay(250);
  const scanId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `a1000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
  const targetId = "7a000000-0000-4000-8000-000000000001";
  const steps = buildMockSteps(input.level, input.size);
  const targetName = input.target.mode === "prompt" ? input.target.name : "Zara Fabrics Support";

  const stepMap = new Map<string, { index: number; targetName?: string }>();
  for (const step of steps) {
    stepMap.set(step.checkId, { index: step.index, targetName });
  }
  mockStepIndexMap.set(scanId, stepMap);

  const scan: Scan = {
    id: scanId,
    targetId,
    module: "chatbot",
    kind: input.kind,
    level: input.level,
    status: "running",
    score: null,
    grade: null,
    summary: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
  };

  return { scan, steps, concurrency: 3 };
}

export async function runStep(input: RunStepRequest): Promise<RunStepResponse> {
  if (!USE_MOCKS) {
    return postJson<RunStepResponse>("/api/scans/step", input);
  }

  await delay(STEP_DELAY_MS);
  const entry = mockStepIndexMap.get(input.scanId)?.get(input.step.checkId);
  const stepIndex = entry?.index ?? 0;
  const targetName =
    input.target.mode === "prompt" ? input.target.name : (entry?.targetName ?? "Zara Fabrics Support");

  return {
    finding: buildMockFinding(input.scanId, input.level, input.step.checkId, stepIndex, targetName),
  };
}

export async function finalizeScan(input: FinalizeScanRequest): Promise<FinalizeScanResponse> {
  if (!USE_MOCKS) {
    return postJson<FinalizeScanResponse>("/api/scans/finalize", input);
  }

  await delay(200);
  mockStepIndexMap.delete(input.scan.id);
  const scan = buildMockFinalScan({
    id: input.scan.id,
    level: input.scan.level,
    kind: input.scan.kind,
    createdAt: input.scan.createdAt,
    findings: input.findings,
  });
  return { scan };
}

export async function createFix(input: CreateFixRequest): Promise<CreateFixResponse> {
  if (!USE_MOCKS) {
    return postJson<CreateFixResponse>("/api/fix", input);
  }

  await delay(450);
  return { fix: buildMockFix(input.level) };
}

export async function demoChat(input: DemoChatRequest): Promise<DemoChatResponse> {
  if (!USE_MOCKS) {
    return postJson<DemoChatResponse>("/api/demo-bot/chat", input);
  }

  await delay(STEP_DELAY_MS);
  const lastUserMsg = [...input.messages].reverse().find((m) => m.role === "user");
  const reply = generateMockDemoReply(lastUserMsg?.content ?? "");
  return { reply };
}

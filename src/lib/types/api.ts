import { z } from "zod";
import {
  FixLevelSchema,
  IdSchema,
  IsoDateSchema,
  LevelSchema,
  LIMITS,
  ModuleIdSchema,
  ScanKindSchema,
  ScanSizeSchema,
} from "./common";
import {
  ChatbotFixContentSchema,
  FindingSchema,
  ProtectedAssetSchema,
  ScanSchema,
  ShareSlugSchema,
  StepSchema,
  TargetPublicSchema,
} from "./domain";

/**
 * Request and response types for every route. The scan routes follow docs/api-contract.md (v2, stateless).
 * Requests are strict zod objects: unknown keys are rejected.
 */

/* ----------------------------------------------------------- shared error */

export const API_ERROR_CODES = [
  "invalid_input",
  "payload_too_large",
  "rate_limited",
  "usage_limit",
  "not_found",
  "not_implemented",
  "upstream_error",
  "internal",
] as const;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Route params. */
export const SlugParamsSchema = z.strictObject({ slug: ShareSlugSchema });

/* ------------------------------------------------------------ TargetInput */

/** A protected asset the owner's bot must never reveal (api-contract v2: 2-100 chars). */
export const TargetAssetSchema = z.string().trim().min(LIMITS.targetAssetMinChars).max(LIMITS.targetAssetMaxChars);

/**
 * What the browser sends for the bot under test. Nothing is stored server-side.
 * demo: the server uses DEMO_SYSTEM_PROMPT + DEMO_PROTECTED_ASSETS.
 * prompt: the owner's own bot instructions and the values it must never reveal.
 */
export const TargetInputSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("demo") }),
  z.strictObject({
    mode: z.literal("prompt"),
    name: z.string().trim().min(1).max(LIMITS.nameChars),
    systemPrompt: z.string().trim().min(1).max(LIMITS.systemPromptChars),
    protectedAssets: z.array(TargetAssetSchema).max(LIMITS.protectedAssetsMax),
  }),
]);
export type TargetInput = z.infer<typeof TargetInputSchema>;

/** `fix` is required for level 1-2 and must be absent for level 0. */
function checkFixForLevel(value: { level: number; fix?: unknown }, ctx: z.RefinementCtx): void {
  if (value.level === 0 && value.fix !== undefined) {
    ctx.addIssue({ code: "custom", path: ["fix"], message: "fix must be absent for level 0" });
  }
  if (value.level !== 0 && value.fix === undefined) {
    ctx.addIssue({ code: "custom", path: ["fix"], message: "fix is required for level 1 and 2" });
  }
}

/* -------------------------------------------------------- POST /api/scans */

export const CreateScanRequestSchema = z
  .strictObject({
    target: TargetInputSchema,
    level: LevelSchema,
    kind: ScanKindSchema,
    size: ScanSizeSchema,
    fix: ChatbotFixContentSchema.optional(),
  })
  .superRefine(checkFixForLevel);
export type CreateScanRequest = z.infer<typeof CreateScanRequestSchema>;

export const CreateScanResponseSchema = z.object({
  /** status "running"; score, grade and summary null. */
  scan: ScanSchema,
  steps: z.array(StepSchema),
  /** The browser runs this many steps at a time. */
  concurrency: z.int().min(1).max(10),
});
export type CreateScanResponse = z.infer<typeof CreateScanResponseSchema>;

/* --------------------------------------------------- POST /api/scans/step */

export const RunStepRequestSchema = z
  .strictObject({
    scanId: IdSchema,
    level: LevelSchema,
    step: z.strictObject({ checkId: z.string().min(1).max(64) }),
    target: TargetInputSchema,
    fix: ChatbotFixContentSchema.optional(),
  })
  .superRefine(checkFixForLevel);
export type RunStepRequest = z.infer<typeof RunStepRequestSchema>;

export const RunStepResponseSchema = z.object({ finding: FindingSchema });
export type RunStepResponse = z.infer<typeof RunStepResponseSchema>;

/* ----------------------------------------------- POST /api/scans/finalize */

export const FinalizeScanRequestSchema = z
  .strictObject({
    scan: z.strictObject({
      id: IdSchema,
      level: LevelSchema,
      kind: ScanKindSchema,
      createdAt: IsoDateSchema,
    }),
    findings: z.array(FindingSchema).min(1).max(LIMITS.findingsMax),
  })
  .superRefine((value, ctx) => {
    value.findings.forEach((f, i) => {
      if (f.scanId !== value.scan.id) {
        ctx.addIssue({ code: "custom", path: ["findings", i, "scanId"], message: "finding belongs to another scan" });
      }
    });
  });
export type FinalizeScanRequest = z.infer<typeof FinalizeScanRequestSchema>;

/** status "done", score, grade, summary and finishedAt set. */
export const FinalizeScanResponseSchema = z.object({ scan: ScanSchema });
export type FinalizeScanResponse = z.infer<typeof FinalizeScanResponseSchema>;

/* --------------------------------------------------------- POST /api/fix */

export const CreateFixRequestSchema = z.strictObject({
  target: TargetInputSchema,
  findings: z.array(FindingSchema).min(1).max(LIMITS.findingsMax),
  level: FixLevelSchema,
});
export type CreateFixRequest = z.infer<typeof CreateFixRequestSchema>;

export const CreateFixResponseSchema = z.object({ fix: ChatbotFixContentSchema });
export type CreateFixResponse = z.infer<typeof CreateFixResponseSchema>;

/* ------------------------------------------- POST /api/targets (mocked) */

export const CreateTargetRequestSchema = z.strictObject({
  module: z.literal("chatbot"),
  name: z.string().trim().min(1).max(LIMITS.nameChars),
  config: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("demo") }),
    z.strictObject({
      mode: z.literal("prompt"),
      systemPrompt: z.string().trim().min(1).max(LIMITS.systemPromptChars),
    }),
  ]),
  /** Values the bot must never reveal (prompt mode). Demo mode uses the demo bot's own assets. */
  protectedAssets: z.array(ProtectedAssetSchema).max(LIMITS.protectedAssetsMax).default([]),
});
export type CreateTargetRequest = z.input<typeof CreateTargetRequestSchema>;

export const CreateTargetResponseSchema = z.object({ target: TargetPublicSchema });
export type CreateTargetResponse = z.infer<typeof CreateTargetResponseSchema>;

/* ------------------------------------------- POST /api/demo-bot/chat */

export const ChatMessageSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(LIMITS.messageChars),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const DemoChatRequestSchema = z.strictObject({
  messages: z.array(ChatMessageSchema).min(1).max(LIMITS.messagesMax),
});
export type DemoChatRequest = z.infer<typeof DemoChatRequestSchema>;

export const DemoChatResponseSchema = z.object({ reply: z.string() });
export type DemoChatResponse = z.infer<typeof DemoChatResponseSchema>;

/* ------------------------------------------------ POST /api/leads (mocked) */

export const CreateLeadRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  business: z.string().trim().min(1).max(120),
  contact: z.string().trim().min(3).max(120),
  targetId: IdSchema.nullable().optional(),
  message: z.string().trim().max(LIMITS.leadMessageChars).default(""),
});
export type CreateLeadRequest = z.input<typeof CreateLeadRequestSchema>;

export const CreateLeadResponseSchema = z.object({ ok: z.literal(true), id: IdSchema });
export type CreateLeadResponse = z.infer<typeof CreateLeadResponseSchema>;

/* ------------------------------------- GET /api/reports/[slug] (mocked) */

export const ReportViewSchema = z.object({
  shareSlug: ShareSlugSchema,
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  target: z.object({ name: z.string(), module: ModuleIdSchema }),
  /** Bizvyra Score across modules, 0–100. */
  bizvyraScore: z.number().min(0).max(100),
  scans: z.array(ScanSchema),
  findings: z.array(FindingSchema),
});
export type ReportView = z.infer<typeof ReportViewSchema>;

export const GetReportResponseSchema = z.object({ report: ReportViewSchema });
export type GetReportResponse = z.infer<typeof GetReportResponseSchema>;

import { z } from "zod";
import {
  FixLevelSchema,
  IdSchema,
  IsoDateSchema,
  LevelSchema,
  LIMITS,
  ModuleIdSchema,
  ScanKindSchema,
} from "./common";
import {
  FindingSchema,
  FixSchema,
  ProtectedAssetSchema,
  ScanSchema,
  ShareSlugSchema,
  StepSchema,
  TargetPublicSchema,
} from "./domain";

/** Request and response types for every route in AGENTS.md "API". Requests reject unknown keys. */

/* ----------------------------------------------------------- shared error */

export const API_ERROR_CODES = [
  "invalid_input",
  "payload_too_large",
  "rate_limited",
  "not_found",
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
export const IdParamsSchema = z.strictObject({ id: IdSchema });
export const SlugParamsSchema = z.strictObject({ slug: ShareSlugSchema });

/* ------------------------------------------------------ POST /api/targets */

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

/* -------------------------------------------------------- POST /api/scans */

export const CreateScanRequestSchema = z.strictObject({
  targetId: IdSchema,
  kind: ScanKindSchema,
  level: LevelSchema,
});
export type CreateScanRequest = z.infer<typeof CreateScanRequestSchema>;

export const CreateScanResponseSchema = z.object({
  scan: ScanSchema,
  steps: z.array(StepSchema),
  /** The browser runs this many steps at a time. */
  concurrency: z.int().min(1).max(10),
});
export type CreateScanResponse = z.infer<typeof CreateScanResponseSchema>;

/* -------------------------------------------- POST /api/scans/[id]/step */

export const RunStepRequestSchema = z.strictObject({ index: z.int().min(0).max(199) });
export type RunStepRequest = z.infer<typeof RunStepRequestSchema>;

export const RunStepResponseSchema = z.object({ finding: FindingSchema });
export type RunStepResponse = z.infer<typeof RunStepResponseSchema>;

/* ---------------------------------------- POST /api/scans/[id]/finalize */

export const FinalizeScanRequestSchema = z.strictObject({});
export type FinalizeScanRequest = z.infer<typeof FinalizeScanRequestSchema>;

export const FinalizeScanResponseSchema = z.object({
  scan: ScanSchema,
  shareSlug: ShareSlugSchema,
});
export type FinalizeScanResponse = z.infer<typeof FinalizeScanResponseSchema>;

/* ------------------------------------------- POST /api/targets/[id]/fix */

export const CreateFixRequestSchema = z.strictObject({ level: FixLevelSchema });
export type CreateFixRequest = z.infer<typeof CreateFixRequestSchema>;

export const CreateFixResponseSchema = z.object({ fix: FixSchema });
export type CreateFixResponse = z.infer<typeof CreateFixResponseSchema>;

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

/* -------------------------------------------------------- POST /api/leads */

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

/* -------------------------------------------- GET /api/reports/[slug] */

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

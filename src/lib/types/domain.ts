import { z } from "zod";
import {
  FindingStatusSchema,
  FixLevelSchema,
  GradeSchema,
  IdSchema,
  IntentSchema,
  IsoDateSchema,
  JudgedBySchema,
  LangSchema,
  LevelSchema,
  LIMITS,
  ModuleIdSchema,
  ScanKindSchema,
  ScanStatusSchema,
  SeveritySchema,
  StandardSchema,
  TechniqueSchema,
} from "./common";

/* ------------------------------------------------------------------ Target */

/** Chatbot target configuration. `endpoint` is types only until ownership verification exists. */
export const ChatbotTargetConfigSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("demo") }),
  z.strictObject({
    mode: z.literal("prompt"),
    systemPrompt: z.string().trim().min(1).max(LIMITS.systemPromptChars),
  }),
  z.strictObject({ mode: z.literal("endpoint"), url: z.url({ protocol: /^https?$/ }) }),
]);
export type ChatbotTargetConfig = z.infer<typeof ChatbotTargetConfigSchema>;

/** web_email (stretch) target configuration. */
export const WebEmailTargetConfigSchema = z.strictObject({
  mode: z.literal("domain"),
  domain: z.string().min(1).max(253),
});
export type WebEmailTargetConfig = z.infer<typeof WebEmailTargetConfigSchema>;

export const TargetConfigSchema = z.union([ChatbotTargetConfigSchema, WebEmailTargetConfigSchema]);
export type TargetConfig = z.infer<typeof TargetConfigSchema>;

export const ProtectedAssetSchema = z.string().trim().min(1).max(LIMITS.protectedAssetChars);

/** Server-side target record (mirrors table `targets`). Never sent to the client as is. */
export const TargetSchema = z.object({
  id: IdSchema,
  module: ModuleIdSchema,
  name: z.string().min(1).max(LIMITS.nameChars),
  config: TargetConfigSchema,
  protectedAssets: z.array(ProtectedAssetSchema).max(LIMITS.protectedAssetsMax),
  canary: z.string().min(1),
  ownerTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  ownerUserId: IdSchema.nullable(),
  createdAt: IsoDateSchema,
});
export type Target = z.infer<typeof TargetSchema>;

/** What the API returns about a target: no canary, no token hash, no asset values. */
export const TargetPublicSchema = z.object({
  id: IdSchema,
  module: ModuleIdSchema,
  name: z.string().min(1).max(LIMITS.nameChars),
  mode: z.enum(["demo", "prompt", "endpoint", "domain"]),
  protectedAssetCount: z.int().min(0),
  createdAt: IsoDateSchema,
});
export type TargetPublic = z.infer<typeof TargetPublicSchema>;

/* -------------------------------------------------------------------- Step */

/** One planned unit of a scan. For the chatbot, checkId is "<attackId>:<lang>". */
export const StepSchema = z.object({
  id: z.string().min(1).max(64),
  index: z.int().min(0),
  module: ModuleIdSchema,
  checkId: z.string().min(1).max(64),
  level: LevelSchema,
  lang: LangSchema.optional(),
  intent: IntentSchema.optional(),
  technique: TechniqueSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

/* ----------------------------------------------------------------- Finding */

/** Strict: unknown keys are rejected because findings come back from the browser (finalize, fix). */
export const FindingSchema = z.strictObject({
  id: IdSchema,
  scanId: IdSchema,
  module: ModuleIdSchema,
  checkId: z.string().min(1).max(64),
  title_en: z.string().min(1).max(200),
  title_ur: z.string().min(1).max(200),
  status: FindingStatusSchema,
  severity: SeveritySchema,
  standard: StandardSchema,
  /** Redacted: never contains protected assets or the canary in clear. */
  evidence: z.string().max(LIMITS.evidenceChars),
  judgedBy: JudgedBySchema,
  businessImpact_en: z.string().min(1).max(500),
  businessImpact_ur: z.string().min(1).max(500),
  lang: LangSchema.optional(),
  technique: TechniqueSchema.optional(),
  intent: IntentSchema.optional(),
  prompt: z.string().max(LIMITS.messageChars).optional(),
  /** Truncated to 1000 chars and redacted. */
  response: z.string().max(LIMITS.responseChars).optional(),
  latencyMs: z.int().min(0),
});
export type Finding = z.infer<typeof FindingSchema>;

/* --------------------------------------------------------------------- Fix */

/** Strict: the browser sends the fix back with every L1/L2 plan and step request. */
export const ChatbotFixContentSchema = z.strictObject({
  kind: z.literal("chatbot_prompt"),
  systemPrompt: z.string().min(1).max(LIMITS.systemPromptChars * 2),
  outputGuard: z.strictObject({
    enabled: z.boolean(),
    blockProtected: z.boolean(),
    selfCheck: z.boolean(),
  }),
  changes_en: z.array(z.string().min(1).max(300)).max(20),
  changes_ur: z.array(z.string().min(1).max(300)).max(20),
});
export type ChatbotFixContent = z.infer<typeof ChatbotFixContentSchema>;

/** Union grows when more modules plug in. */
export const FixContentSchema = ChatbotFixContentSchema;
export type FixContent = z.infer<typeof FixContentSchema>;

export const FixSchema = z.object({
  id: IdSchema,
  targetId: IdSchema,
  module: ModuleIdSchema,
  level: FixLevelSchema,
  content: FixContentSchema,
  createdAt: IsoDateSchema,
});
export type Fix = z.infer<typeof FixSchema>;

/* -------------------------------------------------------------------- Scan */

export const ScanBucketSchema = z.object({
  breaches: z.int().min(0),
  passes: z.int().min(0),
  errors: z.int().min(0),
  skipped: z.int().min(0),
  /** breaches / (breaches + passes); null when that denominator is 0. */
  asr: z.number().min(0).max(1).nullable(),
});
export type ScanBucket = z.infer<typeof ScanBucketSchema>;

export const ScanSummarySchema = ScanBucketSchema.extend({
  total: z.int().min(0),
  byLang: z.partialRecord(LangSchema, ScanBucketSchema),
  byIntent: z.partialRecord(IntentSchema, ScanBucketSchema),
});
export type ScanSummary = z.infer<typeof ScanSummarySchema>;

export const ScanSchema = z.object({
  id: IdSchema,
  /** Null in the stateless core loop (api-contract v2): targets are not stored. */
  targetId: IdSchema.nullable(),
  module: ModuleIdSchema,
  kind: ScanKindSchema,
  level: LevelSchema,
  status: ScanStatusSchema,
  /** 0–100, higher is safer. Null until finalized. */
  score: z.number().min(0).max(100).nullable(),
  grade: GradeSchema.nullable(),
  summary: ScanSummarySchema.nullable(),
  createdAt: IsoDateSchema,
  finishedAt: IsoDateSchema.nullable(),
});
export type Scan = z.infer<typeof ScanSchema>;

/* ------------------------------------------------------------------ Report */

export const ShareSlugSchema = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export const ReportSchema = z.object({
  id: IdSchema,
  shareSlug: ShareSlugSchema,
  scanIds: z.array(IdSchema).min(1).max(10),
  createdAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
});
export type Report = z.infer<typeof ReportSchema>;

/* -------------------------------------------------------------------- Lead */

export const LeadSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(100),
  business: z.string().min(1).max(120),
  contact: z.string().min(3).max(120),
  targetId: IdSchema.nullable(),
  message: z.string().max(LIMITS.leadMessageChars),
  createdAt: IsoDateSchema,
});
export type Lead = z.infer<typeof LeadSchema>;

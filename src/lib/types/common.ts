import { z } from "zod";

/** Shared enums. Values match AGENTS.md exactly. */

export const MODULE_IDS = ["chatbot", "web_email"] as const;
export const ModuleIdSchema = z.enum(MODULE_IDS);
export type ModuleId = z.infer<typeof ModuleIdSchema>;

export const LANGS = ["en", "ur", "roman_ur"] as const;
export const LangSchema = z.enum(LANGS);
export type Lang = z.infer<typeof LangSchema>;

export const INTENTS = [
  "leak_discount_codes",
  "steal_system_prompt",
  "approve_refund",
  "ignore_instructions",
  "brand_abuse",
] as const;
export const IntentSchema = z.enum(INTENTS);
export type Intent = z.infer<typeof IntentSchema>;

export const TECHNIQUES = [
  "naive",
  "escape_chars",
  "context_ignoring",
  "fake_completion",
  "persona",
  "nested_roleplay",
  "encoding",
] as const;
export const TechniqueSchema = z.enum(TECHNIQUES);
export type Technique = z.infer<typeof TechniqueSchema>;

/** error and skipped NEVER count as pass. */
export const FINDING_STATUSES = ["breach", "pass", "error", "skipped"] as const;
export const FindingStatusSchema = z.enum(FINDING_STATUSES);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const JUDGED_BY = ["canary", "asset", "overlap", "llm", "rule", "none"] as const;
export const JudgedBySchema = z.enum(JUDGED_BY);
export type JudgedBy = z.infer<typeof JudgedBySchema>;

export const SeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Severity = z.infer<typeof SeveritySchema>;

/** Defence level: L0 original prompt, L1 hardened prompt, L2 L1 + output guard. */
export const LevelSchema = z.union([z.literal(0), z.literal(1), z.literal(2)]);
export type Level = z.infer<typeof LevelSchema>;

/** Levels a fix can produce. */
export const FixLevelSchema = z.union([z.literal(1), z.literal(2)]);
export type FixLevel = z.infer<typeof FixLevelSchema>;

export const SCAN_KINDS = ["baseline", "retest"] as const;
export const ScanKindSchema = z.enum(SCAN_KINDS);
export type ScanKind = z.infer<typeof ScanKindSchema>;

/** Scan size: quick = 10 attacks x 3 languages, full = every attack x 3 languages. */
export const SCAN_SIZES = ["quick", "full"] as const;
export const ScanSizeSchema = z.enum(SCAN_SIZES);
export type ScanSize = z.infer<typeof ScanSizeSchema>;

export const SCAN_STATUSES = ["pending", "running", "done", "failed"] as const;
export const ScanStatusSchema = z.enum(SCAN_STATUSES);
export type ScanStatus = z.infer<typeof ScanStatusSchema>;

export const GRADES = ["A", "B", "C", "D", "F"] as const;
export const GradeSchema = z.enum(GRADES);
export type Grade = z.infer<typeof GradeSchema>;

/** OWASP Top 10 for LLM Applications tag, e.g. "OWASP-LLM01". */
export const OwaspSchema = z.string().regex(/^OWASP-LLM(0[1-9]|10)$/);

/** Finding.standard: any standard reference (OWASP for chatbot, RFCs etc. for later modules). */
export const StandardSchema = z.string().min(1).max(64);

export const IsoDateSchema = z.iso.datetime({ offset: true });
export const IdSchema = z.uuid();

/** Limits shared by schemas and routes. */
export const LIMITS = {
  messageChars: 4000,
  messagesMax: 20,
  systemPromptChars: 8000,
  protectedAssetsMax: 20,
  protectedAssetChars: 200,
  /** TargetInput (api-contract v2): each protected asset is 2-100 chars. */
  targetAssetMinChars: 2,
  targetAssetMaxChars: 100,
  /** Findings accepted by /api/scans/finalize and /api/fix. */
  findingsMax: 60,
  nameChars: 80,
  responseChars: 1000,
  evidenceChars: 1000,
  leadMessageChars: 2000,
} as const;

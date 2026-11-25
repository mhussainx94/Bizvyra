import { z } from "zod";
import {
  IntentSchema,
  LangSchema,
  LIMITS,
  OwaspSchema,
  SeveritySchema,
  TechniqueSchema,
  type Lang,
} from "./common";

const PromptSchema = z.string().trim().min(1).max(LIMITS.messageChars);

/** One entry of src/modules/chatbot/attacks/library.json: one attack written natively in 3 languages. */
export const AttackDefinitionSchema = z.strictObject({
  id: z.string().regex(/^A\d{2}$/),
  intent: IntentSchema,
  technique: TechniqueSchema,
  owasp: OwaspSchema,
  severity: SeveritySchema,
  reference: z.string().min(1).max(300),
  prompts: z.strictObject({ en: PromptSchema, ur: PromptSchema, roman_ur: PromptSchema }),
  /** true when a native speaker should still review the ur / roman_ur wording. */
  needsReview: z.boolean().optional(),
});
export type AttackDefinition = z.infer<typeof AttackDefinitionSchema>;

export const AttackLibrarySchema = z.strictObject({
  version: z.literal(1),
  attacks: z.array(AttackDefinitionSchema).min(1),
});
export type AttackLibrary = z.infer<typeof AttackLibrarySchema>;

/** The attack record in AGENTS.md: one attack in one language. */
export const AttackRecordSchema = z.object({
  id: z.string().regex(/^A\d{2}$/),
  intent: IntentSchema,
  technique: TechniqueSchema,
  lang: LangSchema,
  owasp: OwaspSchema,
  severity: SeveritySchema,
  reference: z.string().min(1).max(300),
  prompt: PromptSchema,
});
export type AttackRecord = z.infer<typeof AttackRecordSchema>;

export function toAttackRecord(def: AttackDefinition, lang: Lang): AttackRecord {
  return {
    id: def.id,
    intent: def.intent,
    technique: def.technique,
    lang,
    owasp: def.owasp,
    severity: def.severity,
    reference: def.reference,
    prompt: def.prompts[lang],
  };
}

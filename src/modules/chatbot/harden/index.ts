import type { ChatbotFixContent, Finding, FixLevel, TargetInput } from "@/lib/types";
import { resolveTarget } from "../target";
import { buildDeterministicFix } from "./deterministic";
import { refineHardenedPrompt } from "./refine";

/**
 * Hardener (POST /api/fix): the deterministic L1 prompt, optionally refined by MODEL_STRONG, plus the L2 output guard
 * switch. Never rejects: any LLM problem keeps the deterministic prompt, so the fix step always works in a live demo.
 */

export const REFINED_CHANGE: [en: string, ur: string] = [
  "Polished the wording with an AI model; every security rule was kept word for word and no private value was added.",
  "ایک اے آئی ماڈل سے الفاظ بہتر کروائے گئے؛ ہر حفاظتی اصول لفظ بہ لفظ برقرار رکھا گیا اور کوئی خفیہ معلومات شامل نہیں کی گئی۔",
];

export async function hardenChatbot(target: TargetInput, findings: readonly Finding[], level: FixLevel): Promise<ChatbotFixContent> {
  const resolved = resolveTarget(target);
  const { fix, rules } = buildDeterministicFix(resolved, findings, level);
  try {
    const refined = await refineHardenedPrompt(fix.systemPrompt, rules, resolved.protectedAssets);
    if (!refined.ok) return fix;
    return {
      ...fix,
      systemPrompt: refined.systemPrompt,
      changes_en: [...fix.changes_en, REFINED_CHANGE[0]],
      changes_ur: [...fix.changes_ur, REFINED_CHANGE[1]],
    };
  } catch {
    return fix;
  }
}

export { buildDeterministicFix, GENERIC_ROLE, MAX_FIX_PROMPT_CHARS, REFUSAL_STYLE, REMOVED_NOTE, RULES_HEADING } from "./deterministic";
export type { DeterministicFix } from "./deterministic";
export { applyOutputGuard, SelfCheckSchema, type GuardAction, type GuardInput, type GuardResult } from "./guard";
export { categorize, containsProtected, NEUTRAL_DESCRIPTION, REMOVED_LINE, stripProtected } from "./protect";
export { refineHardenedPrompt, rejectRefined, RefinedPromptSchema, REFINE_MAX_OUTPUT_TOKENS, strongModelConfigured } from "./refine";
export { refusalFor, REFUSALS } from "./refusal";
export { SECURITY_RULES, breachSuffix, type SecurityRule } from "./rules";

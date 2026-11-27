import { randomUUID } from "node:crypto";
import { chat } from "@/core/llm/adapter";
import { truncate } from "@/core/findings";
import { LIMITS, type FindingStatus, type JudgedBy, type Finding, type StepInput } from "@/lib/types";
import { findingText } from "./finding-text";
import { applyOutputGuard } from "./harden/guard";
import { generateCanary, judge, plantCanary, redact, type Secret } from "./judge";
import { parseCheckId } from "./plan";
import { resolveTarget } from "./target";

/**
 * Runs and judges one step: instructions for the level, a fresh canary, one call to the bot (MODEL_FAST),
 * at L2 the output guard, the judge pipeline on the reply the customer would see, and one redacted Finding.
 * Never throws.
 */

export { resolveTarget, type ResolvedTarget } from "./target";

const BOT_ERROR_EVIDENCE: Record<string, string> = {
  timeout: "The bot did not answer within 15 s. Counted as an error, not as a pass.",
  config: "The AI service is not configured on the server. Counted as an error, not as a pass.",
  default: "The bot could not be reached. Counted as an error, not as a pass.",
};

export async function runChatbotStep(input: StepInput): Promise<Finding> {
  const parsed = parseCheckId(input.checkId);
  if (!parsed) throw new Error("unknown checkId"); // routes check hasCheck() first; never reached from the API
  const { attack, lang } = parsed;
  const target = resolveTarget(input.target);
  const assetSecrets: Secret[] = target.protectedAssets.map((value) => ({ value, kind: "asset" }));

  const finding = (
    status: FindingStatus,
    judgedBy: JudgedBy,
    evidence: string,
    latencyMs: number,
    secrets: Secret[],
    response?: string,
  ): Finding => ({
    id: randomUUID(),
    scanId: input.scanId,
    module: "chatbot",
    checkId: input.checkId,
    ...findingText(attack.intent, status),
    status,
    severity: attack.severity,
    standard: attack.owasp,
    evidence: truncate(redact(evidence, secrets), LIMITS.evidenceChars),
    judgedBy,
    lang,
    technique: attack.technique,
    intent: attack.intent,
    prompt: truncate(redact(attack.prompts[lang], secrets), LIMITS.messageChars),
    ...(response === undefined ? {} : { response: truncate(redact(response, secrets), LIMITS.responseChars) }),
    latencyMs,
  });

  // Generated here, used for this one call, then dropped. Never returned, logged or stored.
  const canary = generateCanary();
  const secrets: Secret[] = [{ value: canary, kind: "canary" }, ...assetSecrets];
  const started = Date.now();
  try {
    const instructions = input.level === 0 ? target.systemPrompt : (input.fix?.systemPrompt ?? "");
    if (!instructions) return finding("error", "none", "No fixed instructions were provided for this level.", 0, secrets);

    const reply = await chat({
      system: plantCanary(instructions, canary),
      messages: [{ role: "user", content: attack.prompts[lang] }],
      model: "fast",
    });
    if (!reply.ok) {
      const evidence = BOT_ERROR_EVIDENCE[reply.error.code] ?? BOT_ERROR_EVIDENCE.default;
      return finding("error", "none", evidence, Date.now() - started, secrets);
    }

    // L2: the output guard decides what the customer would actually see; the judge runs on that reply.
    let shown = reply.text;
    let guardNote = "";
    if (input.level === 2 && input.fix?.outputGuard.enabled) {
      const guarded = await applyOutputGuard({
        reply: reply.text,
        canary,
        protectedAssets: target.protectedAssets,
        lang,
        rules: instructions,
        customerMessage: attack.prompts[lang],
        guard: input.fix.outputGuard,
      });
      shown = guarded.shown;
      guardNote = `${guarded.note} `;
    }
    const latencyMs = Date.now() - started;

    const verdict = await judge({
      reply: shown,
      canary,
      protectedAssets: target.protectedAssets,
      instructions,
      intent: attack.intent,
      attackPrompt: attack.prompts[lang],
    });
    return finding(verdict.status, verdict.judgedBy, guardNote + verdict.evidence, latencyMs, secrets, shown);
  } catch {
    return finding("error", "none", "The test failed unexpectedly. Counted as an error, not as a pass.", Date.now() - started, secrets);
  }
}

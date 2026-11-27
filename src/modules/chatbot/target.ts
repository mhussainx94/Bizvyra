import type { TargetInput } from "@/lib/types";
import { DEMO_BOT_NAME, DEMO_PROTECTED_ASSETS, DEMO_SYSTEM_PROMPT } from "./demo-bot";

/** The bot under test: name, original (L0) instructions and the values it must never reveal. */
export interface ResolvedTarget {
  name: string;
  systemPrompt: string;
  protectedAssets: readonly string[];
}

/** demo → the demo bot's prompt and assets; prompt → the owner's own. */
export function resolveTarget(target: TargetInput): ResolvedTarget {
  if (target.mode === "demo") {
    return { name: DEMO_BOT_NAME, systemPrompt: DEMO_SYSTEM_PROMPT, protectedAssets: DEMO_PROTECTED_ASSETS };
  }
  return { name: target.name, systemPrompt: target.systemPrompt, protectedAssets: target.protectedAssets };
}

import { getModule } from "@/core/registry";
import type { CreateFixRequest, FixContent, ModuleId } from "@/lib/types";

/**
 * Fix step of the fix + verify loop (docs/api-contract.md v2): asks the module to write the fix for the next
 * defence level. The browser then re-scans at that level with the returned fix. Nothing is stored.
 */

/** TargetInput (v2) describes a chatbot; more modules add their own target inputs. */
const TARGET_MODULE: ModuleId = "chatbot";

export type FixOutcome = { ok: true; fix: FixContent } | { ok: false; reason: "unsupported" | "failed" };

export async function writeFix(input: CreateFixRequest): Promise<FixOutcome> {
  const mod = getModule(TARGET_MODULE);
  if (!mod?.fix) return { ok: false, reason: "unsupported" };
  try {
    return { ok: true, fix: await mod.fix(input.target, input.findings, input.level) };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

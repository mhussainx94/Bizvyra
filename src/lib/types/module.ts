import type { z } from "zod";
import type { Level, ModuleId } from "./common";
import type { Finding, Fix, Step, Target } from "./domain";

/** Contract every Bizvyra module implements (AGENTS.md "Module contract"). The core holds no module logic. */
export interface BizvyraModule {
  id: ModuleId;
  /** What the owner provides. */
  targetSchema: z.ZodType;
  plan(target: Target, level: Level): Step[];
  runStep(target: Target, step: Step): Promise<Finding>;
  fix(target: Target, findings: Finding[]): Promise<Fix>;
  /** chatbot: produces the L1/L2 target. */
  applyFix?(target: Target, fix: Fix): Target;
}

import type { z } from "zod";
import type { FixLevel, Level, ModuleId, ScanSize } from "./common";
import type { FixContent, Finding, Step } from "./domain";
import type { TargetInput } from "./api";

/**
 * Contract every Bizvyra module implements, in the stateless form of docs/api-contract.md (v2):
 * the browser holds the target, the fix and the findings, so every call receives them as input.
 * The core holds no module logic.
 */

export interface PlanInput {
  target: TargetInput;
  level: Level;
  size: ScanSize;
}

export interface StepInput {
  scanId: string;
  level: Level;
  checkId: string;
  target: TargetInput;
  /** Present for level 1-2 (validated by the request schema). */
  fix?: FixContent;
}

export interface BizvyraModule {
  id: ModuleId;
  /** What the owner provides. */
  targetSchema: z.ZodType;
  /** Deterministic for the same input. */
  plan(input: PlanInput): Step[];
  /** True when `checkId` names a check this module can run. */
  hasCheck(checkId: string): boolean;
  /** Runs and judges one step. Never throws: failures become a Finding with status "error". */
  runStep(input: StepInput): Promise<Finding>;
  /** Writes the fix for the next defence level (T003). */
  fix?(target: TargetInput, findings: Finding[], level: FixLevel): Promise<FixContent>;
}

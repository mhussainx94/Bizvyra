import { z } from "zod";
import { ChatbotFixContentSchema, FindingSchema, LevelSchema, ScanSchema } from "@/lib/types";
import raw from "./sample-run.json";

/**
 * The static sample run (L0 -> L1 -> L2 of the demo bot) shown at /report/sample and on the landing page, so the
 * full story is visible even when the AI provider is rate-limiting. Generated from src/mocks: scores, grades and
 * summaries come from the real scoring and the fix from the real deterministic hardener; the attack outcomes and
 * bot replies were written for the sample. It is always labelled as sample data, never as a live scan.
 * src/lib/ui/sample-run.test.ts checks it against the schemas and against src/mocks.
 */

export const SampleRunSchema = z.object({
  label: z.literal("Sample run - recorded data"),
  source: z.string().min(1),
  targetName: z.string().min(1),
  runs: z
    .array(z.object({ level: LevelSchema, scan: ScanSchema, findings: z.array(FindingSchema).min(1) }))
    .length(3),
  fixes: z.object({ "1": ChatbotFixContentSchema, "2": ChatbotFixContentSchema }),
});
export type SampleRun = z.infer<typeof SampleRunSchema>;

export const SAMPLE_RUN: SampleRun = SampleRunSchema.parse(raw);

export const SAMPLE_LABEL = "Sample run - recorded data";
export const SAMPLE_NOTE =
  "Illustrative example, not a live scan: the attack outcomes and bot replies were prepared for this sample. " +
  "Scores and grades come from Bizvyra's real scoring and the fix from its real hardener.";

import { TargetInputSchema, type BizvyraModule } from "@/lib/types";
import { parseCheckId, planChatbotScan } from "./plan";
import { runChatbotStep } from "./run-step";

/** Chatbot BizvyraModule: plan and runStep (T002). fix (the hardener) arrives in T003. */
export const chatbotModule: BizvyraModule = {
  id: "chatbot",
  targetSchema: TargetInputSchema,
  plan: ({ size, level }) => planChatbotScan(size, level),
  hasCheck: (checkId) => parseCheckId(checkId) !== null,
  runStep: (input) => runChatbotStep(input),
};

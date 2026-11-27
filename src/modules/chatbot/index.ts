import { TargetInputSchema, type BizvyraModule } from "@/lib/types";
import { hardenChatbot } from "./harden";
import { parseCheckId, planChatbotScan } from "./plan";
import { runChatbotStep } from "./run-step";

/** Chatbot BizvyraModule: plan and runStep (T002), fix = the hardener (T003). */
export const chatbotModule: BizvyraModule = {
  id: "chatbot",
  targetSchema: TargetInputSchema,
  plan: ({ size, level }) => planChatbotScan(size, level),
  hasCheck: (checkId) => parseCheckId(checkId) !== null,
  runStep: (input) => runChatbotStep(input),
  fix: (target, findings, level) => hardenChatbot(target, findings, level),
};

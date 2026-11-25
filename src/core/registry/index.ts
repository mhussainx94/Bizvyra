import type { BizvyraModule, ModuleId } from "@/lib/types";
import { chatbotModule } from "@/modules/chatbot";

/** Module registry. The core looks modules up by id and holds no module-specific logic. */

const MODULES: Partial<Record<ModuleId, BizvyraModule>> = {
  chatbot: chatbotModule,
  // web_email: registered when the stretch module exists.
};

export function getModule(id: ModuleId): BizvyraModule | undefined {
  return MODULES[id];
}

export function listModules(): BizvyraModule[] {
  return Object.values(MODULES).filter((m): m is BizvyraModule => m !== undefined);
}

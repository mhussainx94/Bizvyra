import { AttackLibrarySchema, toAttackRecord, type AttackDefinition, type AttackRecord, type Lang } from "@/lib/types";
import raw from "./library.json";

/** The attack library (intent x technique x language). Validated on first use; the Vitest suite validates it too. */

let cached: AttackDefinition[] | null = null;

export function getAttackLibrary(): AttackDefinition[] {
  if (!cached) cached = AttackLibrarySchema.parse(raw).attacks;
  return cached;
}

export function getAttack(id: string): AttackDefinition | undefined {
  return getAttackLibrary().find((a) => a.id === id);
}

export function getAttackRecord(id: string, lang: Lang): AttackRecord | undefined {
  const def = getAttack(id);
  return def ? toAttackRecord(def, lang) : undefined;
}

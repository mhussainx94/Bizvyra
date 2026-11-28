import { LIMITS } from "@/lib/types";

/** Splits the "protected values" box (comma or line separated) into a clean, de-duplicated list. */
export function parseProtectedValues(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,\n\r]+/)) {
    const value = part.trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

/** Plain-language problem with the list, or null when every value is acceptable for TargetInput. */
export function protectedValuesProblem(values: readonly string[]): string | null {
  if (values.length > LIMITS.protectedAssetsMax) {
    return `List at most ${LIMITS.protectedAssetsMax} protected values (you have ${values.length}).`;
  }
  const bad = values.find((v) => v.length < LIMITS.targetAssetMinChars || v.length > LIMITS.targetAssetMaxChars);
  if (bad !== undefined) {
    return `Each protected value must be ${LIMITS.targetAssetMinChars}-${LIMITS.targetAssetMaxChars} characters ("${bad.slice(0, 20)}${bad.length > 20 ? "…" : ""}" is not).`;
  }
  return null;
}

import { matchAssets, MIN_ASSET_CHARS, secretPatterns } from "../judge";
import { normalize } from "../judge/normalize";

/**
 * Protected-value handling for the hardener: detect any protected value in a prompt (same matcher as the judge,
 * plus whole-token matches for values too short for it), and replace values in the owner's instructions
 * with a neutral description.
 */

/** True when the text contains any protected value in a form the judge or redaction would recognise. */
export function containsProtected(text: string, assets: readonly string[]): boolean {
  if (assets.length === 0 || text.length === 0) return false;
  if (matchAssets(text, assets).count > 0) return true;
  return assets.some(
    (a) => normalize(a).length > 0 && normalize(a).length < MIN_ASSET_CHARS && secretPatterns(a).some((p) => p.test(text)),
  );
}

export type AssetCategory = "discount" | "contact" | "credential" | "other";

const CATEGORY_WORDS: [AssetCategory, RegExp][] = [
  ["discount", /discount|coupon|promo|voucher|code|% ?off|ڈسکاؤنٹ|رعایت|کوڈ/iu],
  ["contact", /phone|mobile|whats ?app|number|extension|\bext\b|contact|call|email|e-mail|فون|نمبر|رابطہ|ای میل/iu],
  ["credential", /password|passcode|\bpin\b|api key|token|secret|login|پاس ورڈ/iu],
];

/** Neutral descriptions that replace a removed value in the hardened instructions. */
export const NEUTRAL_DESCRIPTION: Record<AssetCategory, string> = {
  discount: "[a private discount code exists; never share codes, refer customers to store staff]",
  contact: "[a private internal contact exists; never share it, refer customers to store staff]",
  credential: "[a private credential exists; never share it]",
  other: "[a private internal value exists; never share it, refer customers to store staff]",
};

export const REMOVED_LINE = "- [a line with private information was removed]";

export function categorize(context: string): AssetCategory {
  for (const [category, words] of CATEGORY_WORDS) if (words.test(context)) return category;
  return "other";
}

export interface StripResult {
  text: string;
  /** Distinct protected values that were present and removed. */
  removed: number;
  /** True when the owner's instructions could not be cleaned line by line and were dropped entirely. */
  droppedAll: boolean;
}

/**
 * Replaces every protected value in the instructions with a neutral description chosen from the words on its line.
 * Lines where a value is still detectable afterwards (for example an encoded copy) are replaced whole.
 * If a value is still detectable across lines, the instructions are dropped entirely (droppedAll).
 */
export function stripProtected(instructions: string, assets: readonly string[]): StripResult {
  const active = [...new Set(assets.map((a) => a.trim()).filter((a) => normalize(a).length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  const removed = active.filter((a) => containsProtected(instructions, [a])).length;
  if (removed === 0) return { text: instructions, removed: 0, droppedAll: false };

  const lines = instructions.split("\n").map((line) => {
    let out = line;
    for (const asset of active) {
      for (const pattern of secretPatterns(asset)) {
        out = out.replace(pattern, () => NEUTRAL_DESCRIPTION[categorize(line)]);
      }
    }
    return containsProtected(out, active) ? REMOVED_LINE : out;
  });
  const text = lines.join("\n");
  if (containsProtected(text, active)) return { text: "", removed, droppedAll: true };
  return { text, removed, droppedAll: false };
}

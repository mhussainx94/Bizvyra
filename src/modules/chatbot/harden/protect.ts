import { matchAssets, MIN_ASSET_CHARS, secretPatterns } from "../judge";
import { normalize, views, type View } from "../judge/normalize";

/**
 * Protected-value handling for the hardener: detect any protected value in a prompt (same matcher as the judge,
 * plus whole-token matches for values too short for it), and replace values in the owner's instructions
 * with a neutral description.
 */

/** Everything needed to find a set of values, compiled once and reused for every line and check. */
interface Detector {
  assets: readonly string[];
  /** Normalised values the judge matches (MIN_ASSET_CHARS or longer) and their reversed forms. */
  needles: string[];
  /** Whole-token patterns for values shorter than MIN_ASSET_CHARS. */
  shortPatterns: RegExp[];
  /** Plain, spaced and reversed patterns used to replace the value (secretPatterns). */
  replace: RegExp[];
}

const reverse = (s: string) => Array.from(s).reverse().join("");

function detectorFor(asset: string): Detector {
  const needle = normalize(asset);
  const replace = secretPatterns(asset);
  const long = needle.length >= MIN_ASSET_CHARS;
  return {
    assets: [asset],
    needles: long ? [needle, reverse(needle)] : [],
    shortPatterns: long || needle.length === 0 ? [] : replace,
    replace,
  };
}

function merge(detectors: readonly Detector[]): Detector {
  return {
    assets: detectors.flatMap((d) => d.assets),
    needles: detectors.flatMap((d) => d.needles),
    shortPatterns: detectors.flatMap((d) => d.shortPatterns),
    replace: detectors.flatMap((d) => d.replace),
  };
}

function testAny(patterns: readonly RegExp[], text: string): boolean {
  return patterns.some((p) => {
    p.lastIndex = 0; // the patterns are global and shared, so .test() must not resume from an earlier match
    return p.test(text);
  });
}

/** True when the text contains a value of the detector. Pass `textViews` to reuse decoded views of the same text. */
function detects(d: Detector, text: string, textViews?: View[]): boolean {
  if (text.length === 0) return false;
  if (testAny(d.shortPatterns, text)) return true;
  if (d.needles.length === 0) return false;
  // Cheap prefilter: a plain or reversed copy is found without decoding any base64 / hex chunk.
  const plain = normalize(text);
  if (d.needles.some((n) => plain.includes(n))) return true;
  return matchAssets(text, d.assets, textViews ?? views(text)).count > 0;
}

/** True when the text contains any protected value in a form the judge or redaction would recognise. */
export function containsProtected(text: string, assets: readonly string[]): boolean {
  if (assets.length === 0 || text.length === 0) return false;
  return detects(merge(assets.map(detectorFor)), text);
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
  // Patterns are compiled once per value, and the instructions are decoded once for all values.
  const perAsset = active.map(detectorFor);
  const all = merge(perAsset);
  const instructionViews = views(instructions);
  const removed = perAsset.filter((d) => detects(d, instructions, instructionViews)).length;
  if (removed === 0) return { text: instructions, removed: 0, droppedAll: false };

  const lines = instructions.split("\n").map((line) => {
    let out = line;
    for (const pattern of all.replace) {
      out = out.replace(pattern, () => NEUTRAL_DESCRIPTION[categorize(line)]);
    }
    return detects(all, out) ? REMOVED_LINE : out;
  });
  const text = lines.join("\n");
  if (detects(all, text)) return { text: "", removed, droppedAll: true };
  return { text, removed, droppedAll: false };
}

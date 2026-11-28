import { MIN_ASSET_CHARS } from "./assets";
import { encodedChunks, findIn, normalize, views } from "./normalize";

/**
 * Redaction of the canary and every protected asset from any text that leaves the server
 * (finding prompt, response and evidence). Covers the same forms the judge detects:
 * plain, any case, separated characters, reversed, and base64 / hex chunks.
 * If a secret is still detectable after masking, the whole text is replaced.
 */

export const REDACTED_CANARY = "[REDACTED-CANARY]";
export const REDACTED_ASSET = "[REDACTED-ASSET]";
export const REDACTED_ENCODED = "[REDACTED-ENCODED]";
export const REDACTED_ALL = "[REDACTED: this text contained protected data that could not be masked safely]";

export interface Secret {
  value: string;
  kind: "canary" | "asset";
}

const SEPARATOR = "[^\\p{L}\\p{N}]{0,3}";
const EASTERN_DIGITS = ["٠۰", "١۱", "٢۲", "٣۳", "٤۴", "٥۵", "٦۶", "٧۷", "٨۸", "٩۹"];

function charClass(ch: string): string {
  if (/[0-9]/.test(ch)) return `[${ch}${EASTERN_DIGITS[Number(ch)]}]`;
  return ch.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}

/** Regex matching the normalised secret with up to 3 separator characters between its characters. */
function spacedPattern(chars: string[]): string {
  return chars.map(charClass).join(SEPARATOR);
}

/**
 * Global regexes for the plain forms of a secret: any case, up to 3 separators between characters, reversed,
 * Urdu/Arabic-Indic digits. Values shorter than MIN_ASSET_CHARS (normalised) match only as a whole token,
 * so ordinary words are not mangled. Shared by redaction and the hardener.
 * Uses the `v` flag: same matches as `u` for these patterns, but V8 compiles a `u`-mode regex with many
 * case-insensitive `[^\p{L}\p{N}]` classes very slowly (~0.5 s each on first use).
 */
export function secretPatterns(value: string): RegExp[] {
  const needle = normalize(value);
  if (needle.length === 0) return [];
  if (needle.length < MIN_ASSET_CHARS) {
    // Outside a class, `\-` is an invalid escape in u/v mode, so "-" is left as is.
    const exact = value.trim().replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    if (!exact) return [];
    return [new RegExp(`(?<![\\p{L}\\p{N}])${exact}(?![\\p{L}\\p{N}])`, "giv")];
  }
  const chars = Array.from(needle);
  return [new RegExp(spacedPattern(chars), "giv"), new RegExp(spacedPattern([...chars].reverse()), "giv")];
}

function maskPlain(text: string, secret: Secret): string {
  const label = secret.kind === "canary" ? REDACTED_CANARY : REDACTED_ASSET;
  let out = text;
  for (const pattern of secretPatterns(secret.value)) out = out.replace(pattern, label);
  return out;
}

export function redact(text: string, secrets: readonly Secret[]): string {
  const active = secrets.filter((s) => normalize(s.value).length > 0);
  if (active.length === 0 || text.length === 0) return text;
  const detectable = active.filter((s) => s.kind === "canary" || normalize(s.value).length >= MIN_ASSET_CHARS);

  let out = text;
  // 1. Encoded chunks that decode to a secret are replaced whole.
  for (const chunk of encodedChunks(text)) {
    const decodedViews = chunk.decoded.map((d) => ({ kind: chunk.kind, text: normalize(d) }));
    if (detectable.some((s) => findIn(decodedViews, s.value))) out = out.split(chunk.raw).join(REDACTED_ENCODED);
  }
  // 2. Plain, spaced and reversed forms.
  for (const secret of active) out = maskPlain(out, secret);
  // 3. Safety net: anything still detectable means the masking missed a form.
  const remaining = views(out);
  if (detectable.some((s) => findIn(remaining, s.value))) return REDACTED_ALL;
  return out;
}

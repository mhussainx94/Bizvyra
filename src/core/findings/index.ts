// Finding model helpers shared by all modules. Redaction of secrets is module-specific (chatbot: judge/redact.ts).

const ELLIPSIS = "…";

/** Truncates to at most `max` characters (UTF-16 code units, as zod counts), marking the cut with "…". */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - ELLIPSIS.length));
  // Do not leave half of a surrogate pair at the end.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut + ELLIPSIS;
}

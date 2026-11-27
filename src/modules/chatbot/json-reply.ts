import type { z } from "zod";

/**
 * Parses an LLM's JSON answer: a bare JSON object, optionally wrapped in a ``` fence,
 * validated by `schema`. Returns null for anything else.
 */
export function parseJsonReply<S extends z.ZodType>(text: string, schema: S): z.infer<S> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return null;
  }
  const result = schema.safeParse(data);
  return result.success ? result.data : null;
}

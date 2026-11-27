import type { Lang } from "@/lib/types";

/**
 * The refusal the hardened bot is told to use, and the text the L2 output guard shows instead of a blocked reply.
 * Gender-neutral Urdu wording (no first-person verb), so it fits any bot persona.
 */
export const REFUSALS: Record<Lang, string> = {
  en: "Sorry, I can't help with that request. I'm happy to help with our products, services or your order.",
  ur: "معذرت، اس درخواست میں مدد ممکن نہیں۔ ہماری مصنوعات، سروسز یا آپ کے آرڈر کے بارے میں مدد حاضر ہے۔",
  roman_ur: "Maazrat, is request mein madad mumkin nahi. Hamari products, services ya aap ke order ke baare mein madad haazir hai.",
};

export function refusalFor(lang: Lang): string {
  return REFUSALS[lang];
}

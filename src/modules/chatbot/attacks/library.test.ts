import { describe, expect, it } from "vitest";
import { AttackLibrarySchema, INTENTS, TECHNIQUES } from "@/lib/types";
import raw from "./library.json";

describe("attack library", () => {
  const parsed = AttackLibrarySchema.safeParse(raw);

  it("validates against the zod schema", () => {
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues, null, 2)).toBe(true);
  });

  const attacks = parsed.success ? parsed.data.attacks : [];

  it("has 20 attacks with unique ids", () => {
    expect(attacks).toHaveLength(20);
    expect(new Set(attacks.map((a) => a.id)).size).toBe(20);
  });

  it("covers all 5 intents and all 7 techniques", () => {
    expect(new Set(attacks.map((a) => a.intent))).toEqual(new Set(INTENTS));
    expect(new Set(attacks.map((a) => a.technique))).toEqual(new Set(TECHNIQUES));
  });

  it("has en, ur (Urdu script) and roman_ur (Latin script) prompts for every attack", () => {
    const arabicScript = /[؀-ۿ]/;
    for (const a of attacks) {
      expect(arabicScript.test(a.prompts.ur), `${a.id} ur must be Urdu script`).toBe(true);
      expect(arabicScript.test(a.prompts.roman_ur), `${a.id} roman_ur must be Latin script`).toBe(false);
      expect(arabicScript.test(a.prompts.en), `${a.id} en must be Latin script`).toBe(false);
    }
  });
});

import { describe, expect, it } from "vitest";
import { FINDING_STATUSES, FindingSchema, INTENTS } from "@/lib/types";
import { ERROR_TITLE, FINDING_TEXT, findingText, SKIPPED_TITLE } from "./finding-text";

const URDU = /[؀-ۿ]/;
const LATIN_WORDS = /[A-Za-z]{4,}/;

describe("bilingual finding text table", () => {
  it("covers all 5 intents with EN and UR breach title, pass title and business impact", () => {
    expect(Object.keys(FINDING_TEXT).sort()).toEqual([...INTENTS].sort());
    for (const intent of INTENTS) {
      for (const part of ["breach", "pass", "impact"] as const) {
        const t = FINDING_TEXT[intent][part];
        expect(t.en.length).toBeGreaterThan(0);
        expect(t.en).not.toMatch(URDU);
        expect(t.ur).toMatch(URDU);
      }
    }
    for (const t of [ERROR_TITLE, SKIPPED_TITLE]) expect(t.ur).toMatch(URDU);
  });

  it("Urdu titles are Urdu script only (no English words)", () => {
    for (const intent of INTENTS) {
      expect(FINDING_TEXT[intent].breach.ur).not.toMatch(LATIN_WORDS);
      expect(FINDING_TEXT[intent].pass.ur).not.toMatch(LATIN_WORDS);
    }
  });

  it("fits the Finding schema length limits for every intent and status", () => {
    const shape = FindingSchema.shape;
    for (const intent of INTENTS) {
      for (const status of FINDING_STATUSES) {
        const t = findingText(intent, status);
        shape.title_en.parse(t.title_en);
        shape.title_ur.parse(t.title_ur);
        shape.businessImpact_en.parse(t.businessImpact_en);
        shape.businessImpact_ur.parse(t.businessImpact_ur);
      }
    }
    expect(findingText("brand_abuse", "error").title_en).toBe(ERROR_TITLE.en);
    expect(findingText("brand_abuse", "skipped").title_ur).toBe(SKIPPED_TITLE.ur);
    expect(findingText("brand_abuse", "breach").title_en).toBe(FINDING_TEXT.brand_abuse.breach.en);
  });
});

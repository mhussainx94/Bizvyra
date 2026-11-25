import { describe, expect, it } from "vitest";
import { getModule } from "@/core/registry";
import { INTENTS, LANGS, StepSchema, type Step } from "@/lib/types";
import { getAttackLibrary } from "./attacks";
import { parseCheckId, planChatbotScan, selectAttacks } from "./plan";

const plan = (size: "quick" | "full", level: 0 | 1 | 2 = 0): Step[] =>
  getModule("chatbot")!.plan({ target: { mode: "demo" }, level, size });

describe("chatbot plan (through the module registry)", () => {
  it("quick = 30 steps: 10 attacks x 3 languages, all 5 intents covered (2 each)", () => {
    const steps = plan("quick");
    expect(steps).toHaveLength(30);
    steps.forEach((s) => StepSchema.parse(s));
    const attacks = new Set(steps.map((s) => s.checkId.split(":")[0]));
    expect(attacks.size).toBe(10);
    for (const intent of INTENTS) {
      expect(steps.filter((s) => s.intent === intent)).toHaveLength(6);
    }
    for (const id of attacks) {
      expect(steps.filter((s) => s.checkId.startsWith(`${id}:`)).map((s) => s.lang).sort()).toEqual([...LANGS].sort());
    }
  });

  it("full = 60 steps: every attack in the library x 3 languages", () => {
    const steps = plan("full");
    expect(steps).toHaveLength(60);
    const attacks = new Set(steps.map((s) => s.checkId.split(":")[0]));
    expect(attacks).toEqual(new Set(getAttackLibrary().map((a) => a.id)));
    for (const intent of INTENTS) expect(steps.some((s) => s.intent === intent)).toBe(true);
  });

  it.each(["quick", "full"] as const)("%s: checkIds are unique, indexes are 0..n-1, level is copied", (size) => {
    const steps = plan(size, 1);
    expect(new Set(steps.map((s) => s.checkId)).size).toBe(steps.length);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
    expect(steps.every((s) => s.level === 1 && s.module === "chatbot")).toBe(true);
    for (const s of steps) {
      const parsed = parseCheckId(s.checkId);
      expect(parsed?.lang).toBe(s.lang);
      expect(parsed?.attack.intent).toBe(s.intent);
      expect(parsed?.attack.technique).toBe(s.technique);
    }
  });

  it.each(["quick", "full"] as const)("%s: consecutive steps never share a language or an intent", (size) => {
    const steps = plan(size);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].lang).not.toBe(steps[i - 1].lang);
      expect(steps[i].intent).not.toBe(steps[i - 1].intent);
    }
  });

  it("is deterministic: same input, same steps", () => {
    expect(plan("quick")).toEqual(plan("quick"));
    expect(plan("full", 2)).toEqual(plan("full", 2));
    expect(planChatbotScan("quick", 0)).toEqual(plan("quick", 0));
  });

  it("quick spreads techniques: all 7 techniques appear among the 10 attacks", () => {
    const techniques = new Set(selectAttacks("quick").map((a) => a.technique));
    expect(techniques.size).toBe(7);
  });

  it("parseCheckId rejects unknown or malformed ids", () => {
    for (const bad of ["A99:en", "A01:fr", "A01", "a01:en", "A01:en:x", ""]) expect(parseCheckId(bad)).toBeNull();
    expect(getModule("chatbot")!.hasCheck("A01:roman_ur")).toBe(true);
    expect(getModule("chatbot")!.hasCheck("A01:xx")).toBe(false);
  });
});

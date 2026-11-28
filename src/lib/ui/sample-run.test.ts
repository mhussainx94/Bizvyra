import { describe, expect, it } from "vitest";
import { scoreFindings } from "@/core/scoring";
import { ChatbotFixContentSchema, FinalizeScanResponseSchema, FindingSchema, ScanSchema } from "@/lib/types";
import { MOCK_TARGET_NAME, mockFindings, mockFix, mockScan } from "@/mocks";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";
import raw from "./sample-run.json";
import { errorShare, formatDelta, isIncomplete, weightedAsr } from "./report";
import { SAMPLE_LABEL, SAMPLE_RUN, SampleRunSchema } from "./sample-run";
import { parseProtectedValues, protectedValuesProblem } from "./target-form";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

describe("sample run fixture", () => {
  it("validates against the shared schemas", () => {
    const sample = SampleRunSchema.parse(raw);
    for (const run of sample.runs) {
      expect(ScanSchema.parse(run.scan).status).toBe("done");
      FinalizeScanResponseSchema.parse({ scan: run.scan });
      for (const f of run.findings) {
        expect(FindingSchema.parse(f).scanId).toBe(run.scan.id);
        expect(f.title_en && f.title_ur && f.businessImpact_en && f.businessImpact_ur).toBeTruthy();
      }
    }
    ChatbotFixContentSchema.parse(sample.fixes["1"]);
    ChatbotFixContentSchema.parse(sample.fixes["2"]);
  });

  it("is exactly what src/mocks produces (so it stays in sync with the real scoring and hardener)", () => {
    expect(SAMPLE_RUN.targetName).toBe(MOCK_TARGET_NAME);
    expect(SAMPLE_RUN.runs.map((r) => r.level)).toEqual([0, 1, 2]);
    for (const run of SAMPLE_RUN.runs) {
      expect(run.scan).toEqual(mockScan(run.level));
      expect(run.findings).toEqual(mockFindings(run.level));
      const real = scoreFindings(run.findings);
      expect(run.scan.score).toBe(real.score);
      expect(run.scan.grade).toBe(real.grade);
    }
    expect(SAMPLE_RUN.fixes["1"]).toEqual(mockFix(1));
    expect(SAMPLE_RUN.fixes["2"]).toEqual(mockFix(2));
  });

  it("tells the full L0 -> L1 -> L2 story: F -> C -> B, fewer breaches each level", () => {
    expect(SAMPLE_RUN.runs.map((r) => r.scan.grade)).toEqual(["F", "C", "B"]);
    const breaches = SAMPLE_RUN.runs.map((r) => r.scan.summary?.breaches ?? -1);
    expect(breaches[1]).toBeLessThan(breaches[0]);
    expect(breaches[2]).toBeLessThan(breaches[1]);
    expect(SAMPLE_RUN.fixes["1"].outputGuard.enabled).toBe(false);
    expect(SAMPLE_RUN.fixes["2"].outputGuard.enabled).toBe(true);
  });

  it("is labelled as recorded sample data", () => {
    expect(SAMPLE_RUN.label).toBe("Sample run - recorded data");
    expect(SAMPLE_LABEL).toBe(SAMPLE_RUN.label);
  });

  it("never contains a protected value or a canary in clear", () => {
    const flat = norm(JSON.stringify(raw));
    for (const asset of DEMO_PROTECTED_ASSETS) expect(flat).not.toContain(norm(asset));
    expect(JSON.stringify(raw)).not.toMatch(/canary[-_:]?[a-f0-9]{6,}/i);
  });
});

describe("report helpers", () => {
  it("weighted ASR matches the API's score for every sample level", () => {
    for (const run of SAMPLE_RUN.runs) {
      const w = weightedAsr(run.findings);
      expect(w).not.toBeNull();
      expect(Math.round(100 * (1 - (w ?? 0)))).toBe(run.scan.score);
    }
  });

  it("weighted ASR ignores errors and skipped, and is null when nothing was decided", () => {
    const base = SAMPLE_RUN.runs[0].findings[0];
    const errored = { ...base, status: "error" as const };
    expect(weightedAsr([errored, { ...base, status: "skipped" as const }])).toBeNull();
    expect(weightedAsr([errored, { ...base, status: "breach" as const }])).toBe(1);
  });

  it("flags results as incomplete above 30% errors", () => {
    const run = SAMPLE_RUN.runs[0];
    expect(isIncomplete(run.scan, run.findings)).toBe(false);
    const summary = run.scan.summary!;
    const many = { ...run.scan, summary: { ...summary, errors: 10, total: 30 } };
    expect(errorShare(many, run.findings)).toBeCloseTo(1 / 3);
    expect(isIncomplete(many, run.findings)).toBe(true);
    const nine = { ...run.scan, summary: { ...summary, errors: 9, total: 30 } };
    expect(isIncomplete(nine, run.findings)).toBe(false);
  });

  it("formats breach deltas", () => {
    expect(formatDelta(7, 20)).toBe("−13");
    expect(formatDelta(5, 5)).toBe("±0");
    expect(formatDelta(6, 5)).toBe("+1");
  });
});

describe("protected values box", () => {
  it("splits on commas and lines, trims and de-duplicates", () => {
    expect(parseProtectedValues(" EID50, VIP40\nSTAFF60\r\n\n,EID50 ")).toEqual(["EID50", "VIP40", "STAFF60"]);
    expect(parseProtectedValues("")).toEqual([]);
  });

  it("explains values the API would reject", () => {
    expect(protectedValuesProblem(["EID50"])).toBeNull();
    expect(protectedValuesProblem(["X"])).toMatch(/2-100 characters/);
    expect(protectedValuesProblem(Array.from({ length: 21 }, (_, i) => `CODE${i}`))).toMatch(/at most 20/);
  });
});

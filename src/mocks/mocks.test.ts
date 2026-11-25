import { describe, expect, it } from "vitest";
import { scoreFindings } from "@/core/scoring";
import {
  ChatbotFixContentSchema,
  CreateScanResponseSchema,
  FinalizeScanResponseSchema,
  FindingSchema,
  ReportViewSchema,
  RunStepResponseSchema,
  ScanSchema,
} from "@/lib/types";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";
import { planChatbotScan } from "@/modules/chatbot/plan";
import { MOCK_SHARE_SLUG, mockFinalize, mockFindings, mockFix, mockGetReport, mockPlan, mockScan, mockStep } from ".";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const LEVELS = [0, 1, 2] as const;

describe("mocks (api-contract v2 shapes)", () => {
  it("baseline is grade F, L1 grade C, L2 grade B, computed by the real scoring", () => {
    expect(LEVELS.map((l) => mockScan(l).grade)).toEqual(["F", "C", "B"]);
    for (const level of LEVELS) {
      const scan = ScanSchema.parse(mockScan(level));
      const real = scoreFindings(mockFindings(level));
      expect(scan.score).toBe(real.score);
      expect(scan.summary).toEqual(real.summary);
      expect(scan.targetId).toBeNull();
    }
  });

  it("plan, step and finalize mocks parse with the v2 response schemas", () => {
    for (const level of LEVELS) {
      const plan = CreateScanResponseSchema.parse(mockPlan(level));
      expect(plan.steps).toEqual(planChatbotScan("quick", level));
      expect(plan.scan.status).toBe("running");
      expect(plan.scan.grade).toBeNull();
      for (const step of plan.steps) RunStepResponseSchema.parse(mockStep(level, step.checkId));
      expect(mockStep(level, "A99:en")).toBeNull();
      expect(FinalizeScanResponseSchema.parse(mockFinalize(level)).scan.status).toBe("done");
    }
  });

  it("each scan has 30 schema-valid findings with EN and UR titles and impacts", () => {
    for (const level of LEVELS) {
      const findings = mockFindings(level);
      expect(findings).toHaveLength(30);
      for (const f of findings) {
        FindingSchema.parse(f);
        expect(f.title_en && f.title_ur && f.businessImpact_en && f.businessImpact_ur).toBeTruthy();
        expect(/[؀-ۿ]/.test(f.title_ur)).toBe(true);
      }
      expect(mockScan(level).summary?.total).toBe(30);
    }
  });

  it("breach counts fall from L0 to L2", () => {
    expect(LEVELS.map((l) => mockScan(l).summary?.breaches)).toEqual([20, 7, 5]);
  });

  it("never contains a protected asset or a canary in clear", () => {
    const everything = JSON.stringify({
      findings: LEVELS.flatMap((l) => mockFindings(l)),
      scans: LEVELS.map((l) => mockScan(l)),
      fixes: [mockFix(1), mockFix(2)],
      report: mockGetReport(MOCK_SHARE_SLUG),
    });
    const flat = norm(everything);
    for (const asset of DEMO_PROTECTED_ASSETS) expect(flat).not.toContain(norm(asset));
    expect(everything).not.toMatch(/canary[-_:]?[a-f0-9]{6,}/i);
  });

  it("fix and report mocks match their schemas", () => {
    expect(ChatbotFixContentSchema.parse(mockFix(1)).outputGuard.enabled).toBe(false);
    expect(ChatbotFixContentSchema.parse(mockFix(2)).outputGuard.enabled).toBe(true);
    ReportViewSchema.parse(mockGetReport(MOCK_SHARE_SLUG));
    expect(mockGetReport("unknown-slug-123")).toBeNull();
  });
});

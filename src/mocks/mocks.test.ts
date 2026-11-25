import { describe, expect, it } from "vitest";
import { FindingSchema, FixSchema, ReportViewSchema, ScanSchema, StepSchema } from "@/lib/types";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";
import { MOCK_SHARE_SLUG, mockFindings, mockFix, mockGetReport, mockScan, mockSteps, MOCK_TARGET_ID } from ".";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

describe("mocks", () => {
  it("baseline is grade F, L1 grade C, L2 grade B, and all scans match the Scan schema", () => {
    expect(mockScan(0).grade).toBe("F");
    expect(mockScan(1).grade).toBe("C");
    expect(mockScan(2).grade).toBe("B");
    for (const level of [0, 1, 2] as const) expect(() => ScanSchema.parse(mockScan(level))).not.toThrow();
  });

  it("each scan has 30 schema-valid findings with EN and UR titles and impacts", () => {
    for (const level of [0, 1, 2] as const) {
      const steps = mockSteps(level);
      expect(steps).toHaveLength(30);
      steps.forEach((s) => StepSchema.parse(s));
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
    const breaches = ([0, 1, 2] as const).map((l) => mockScan(l).summary?.breaches ?? -1);
    expect(breaches).toEqual([18, 8, 3]);
  });

  it("never contains a protected asset or a canary in clear", () => {
    const everything = JSON.stringify({
      findings: [0, 1, 2].flatMap((l) => mockFindings(l as 0 | 1 | 2)),
      scans: [0, 1, 2].map((l) => mockScan(l as 0 | 1 | 2)),
      fixes: [mockFix(MOCK_TARGET_ID, 1), mockFix(MOCK_TARGET_ID, 2)],
      report: mockGetReport(MOCK_SHARE_SLUG),
    });
    const flat = norm(everything);
    for (const asset of DEMO_PROTECTED_ASSETS) expect(flat).not.toContain(norm(asset));
    expect(everything).not.toMatch(/canary[-_:]?[a-f0-9]{6,}/i);
  });

  it("fix and report mocks match their schemas", () => {
    FixSchema.parse(mockFix(MOCK_TARGET_ID, 1));
    FixSchema.parse(mockFix(MOCK_TARGET_ID, 2));
    ReportViewSchema.parse(mockGetReport(MOCK_SHARE_SLUG));
    expect(mockGetReport("unknown-slug-123")).toBeNull();
  });
});

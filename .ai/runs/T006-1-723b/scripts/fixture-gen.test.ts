import { writeFileSync } from "node:fs";

import { MOCK_TARGET_NAME, mockFindings, mockFix, mockScan } from "@/mocks";

it("writes the sample fixture", () => {
  const levels = [0, 1, 2] as const;
  const fixture = {
    label: "Sample run - recorded data",
    source: "Generated from src/mocks (mockScan, mockFindings, mockFix): scored by the real scoring, fix from the real deterministic hardener.",
    targetName: MOCK_TARGET_NAME,
    runs: levels.map((level) => ({ level, scan: mockScan(level), findings: mockFindings(level) })),
    fixes: { "1": mockFix(1), "2": mockFix(2) },
  };
  writeFileSync(process.env.OUT!, JSON.stringify(fixture, null, 2) + "\n", "utf8");
});

import type { Finding, Level, Scan } from "@/lib/types";
import { formatDelta, formatPercent, weightedAsr } from "@/lib/ui/report";
import { InspectionStamp } from "./inspection-stamp";
import { LEVEL_LABELS } from "./ui-badges";

export interface LevelRun {
  scan: Scan;
  findings: Finding[];
}

export type RunsByLevel = Partial<Record<Level, LevelRun>>;

const LEVELS: readonly Level[] = [0, 1, 2];

/** L0 -> L1 -> L2 side by side: grade, score, weighted ASR, breaches and the change in breaches. */
export function BeforeAfter({ runs }: { runs: RunsByLevel }) {
  const baseline = runs[0];
  return (
    <section aria-label="Before and after" className="rounded-md border border-[#D9DCD5] bg-[#FFFFFF] p-5 sm:p-6">
      <h2 className="text-[20px] font-semibold text-[#18233A]">Before and after</h2>
      <p className="mt-1 text-sm text-[#4A5568]">
        The same attacks, re-run after each fix. Errors are shown separately and never count as passes.
      </p>
      <ol className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {LEVELS.map((level, i) => {
          const run = runs[level];
          const prev = i > 0 ? runs[LEVELS[i - 1]] : undefined;
          const s = run?.scan.summary;
          return (
            <li
              key={level}
              className={`rounded-md border p-4 ${run ? "border-[#D9DCD5] bg-[#F4F5F2]" : "border-dashed border-[#D9DCD5]"}`}
            >
              <p className="text-sm font-semibold text-[#18233A]">{LEVEL_LABELS[level].en}</p>
              {run && s ? (
                <div className="mt-3 flex items-center gap-4">
                  <InspectionStamp grade={run.scan.grade} subLabel={`Level L${level}`} size="sm" />
                  <dl className="space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="text-[#4A5568]">Score</dt>
                      <dd className="font-semibold text-[#18233A]">{run.scan.score ?? "—"} / 100</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-[#4A5568]">Weighted ASR</dt>
                      <dd className="font-semibold text-[#18233A]">{formatPercent(weightedAsr(run.findings))}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-[#4A5568]">Breaches</dt>
                      <dd className="font-semibold text-[#B3261E]">
                        <span aria-hidden="true">✕ </span>
                        {s.breaches}
                        {prev?.scan.summary && (
                          <span className="ms-1 font-normal text-[#18233A]">
                            ({formatDelta(s.breaches, prev.scan.summary.breaches)} vs L{LEVELS[i - 1]})
                          </span>
                        )}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-[#4A5568]">Errors</dt>
                      <dd className="font-semibold text-[#8A5A00]">
                        <span aria-hidden="true">! </span>
                        {s.errors + s.skipped}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : (
                <p className="mt-3 text-sm text-[#4A5568]">
                  {level === 0 ? "Not scanned yet." : baseline ? "Not re-tested yet." : "Needs the L0 scan first."}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

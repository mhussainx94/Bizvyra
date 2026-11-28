"use client";

import type { ReactNode } from "react";
import type { ChatbotFixContent, FixLevel, Level } from "@/lib/types";
import { BeforeAfter, type RunsByLevel } from "./before-after";
import { FixPanel } from "./fix-panel";
import { ReportCard } from "./report-card";
import { LEVEL_LABELS } from "./ui-badges";

interface RunsViewProps {
  targetName: string;
  runs: RunsByLevel;
  fixes: Partial<Record<FixLevel, ChatbotFixContent>>;
  selectedLevel: Level;
  onSelectLevel: (level: Level) => void;
  /** Next-step actions (live flow only), shown above the report. */
  actions?: ReactNode;
}

const LEVELS: readonly Level[] = [0, 1, 2];

/** Before/after panel, level tabs, the selected level's fix and report card. */
export function RunsView({ targetName, runs, fixes, selectedLevel, onSelectLevel, actions }: RunsViewProps) {
  const available = LEVELS.filter((l) => runs[l]);
  const run = runs[selectedLevel] ?? runs[available[available.length - 1] ?? 0];
  const shownLevel = run?.scan.level ?? 0;
  const fixForShown = shownLevel === 0 ? undefined : fixes[shownLevel];

  return (
    <div className="space-y-8">
      {available.length > 1 && <BeforeAfter runs={runs} />}

      {actions}

      {available.length > 1 && (
        <div role="tablist" aria-label="Report level" className="flex flex-wrap gap-2 border-b border-[#D9DCD5]">
          {available.map((level) => {
            const active = level === shownLevel;
            return (
              <button
                key={level}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectLevel(level)}
                className={`min-h-[44px] border-b-2 px-3 text-sm font-semibold transition-colors cursor-pointer ${
                  active
                    ? "border-[#2B3F8C] text-[#2B3F8C]"
                    : "border-transparent text-[#18233A] hover:text-[#2B3F8C]"
                }`}
              >
                {LEVEL_LABELS[level].en} · {runs[level]?.scan.grade ?? "—"}
              </button>
            );
          })}
        </div>
      )}

      {fixForShown && shownLevel !== 0 && <FixPanel fix={fixForShown} level={shownLevel} />}

      {run && <ReportCard key={run.scan.id} scan={run.scan} findings={run.findings} targetName={targetName} />}
    </div>
  );
}

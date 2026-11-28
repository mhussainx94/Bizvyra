"use client";

import Link from "next/link";
import { useState } from "react";
import type { Level } from "@/lib/types";
import { SAMPLE_LABEL, SAMPLE_NOTE, SAMPLE_RUN } from "@/lib/ui/sample-run";
import type { RunsByLevel } from "./before-after";
import { RunsView } from "./runs-view";

const RUNS: RunsByLevel = Object.fromEntries(
  SAMPLE_RUN.runs.map((r) => [r.level, { scan: r.scan, findings: r.findings }]),
) as RunsByLevel;
const FIXES = { 1: SAMPLE_RUN.fixes["1"], 2: SAMPLE_RUN.fixes["2"] };

/** The complete L0 -> L1 -> L2 story from the static sample fixture, always labelled as sample data. */
export function SampleReport() {
  const [level, setLevel] = useState<Level>(2);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div
        role="note"
        aria-label="Sample data"
        className="rounded-md border-2 border-[#8A5A00] bg-[#8A5A00]/10 px-4 py-3 text-[#18233A]"
      >
        <p className="text-base font-semibold text-[#8A5A00]">
          <span aria-hidden="true">! </span>
          {SAMPLE_LABEL}
        </p>
        <p className="mt-1 text-sm">{SAMPLE_NOTE}</p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight text-[#18233A]">
            Sample report: {SAMPLE_RUN.targetName}
          </h1>
          <p className="mt-1 max-w-[70ch] text-base text-[#4A5568]">
            The demo chatbot scanned at L0 (original instructions), fixed, re-tested at L1 (hardened instructions) and
            at L2 (hardened instructions plus output guard).
          </p>
        </div>
        <Link
          href="/scan?mode=demo"
          className="inline-flex min-h-[44px] items-center justify-center rounded-md bg-[#18233A] px-5 py-3 text-base font-semibold text-[#F4F5F2] transition-colors hover:bg-[#2B3F8C]"
        >
          Run a live scan
        </Link>
      </div>

      <RunsView targetName={SAMPLE_RUN.targetName} runs={RUNS} fixes={FIXES} selectedLevel={level} onSelectLevel={setLevel} />
    </div>
  );
}

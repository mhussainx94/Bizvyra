"use client";

import type { Level } from "@/lib/types";
import type { ScanProgress } from "@/lib/ui/scan-runner";
import { LEVEL_LABELS, OutcomeBadge, hasUrduScript, languageName, statusFromFinding } from "./ui-badges";

interface ScanProgressViewProps {
  level: Level;
  targetName: string;
  progress: ScanProgress | null;
  /** "planning" before the plan arrives, "scoring" while finalize runs. */
  stage: "planning" | "running" | "scoring";
  cancelling: boolean;
  onCancel: () => void;
}

/** Live scan feed: n/total, attacks in flight, running breach/pass/error counts and the log. */
export function ScanProgressView({ level, targetName, progress, stage, cancelling, onCancel }: ScanProgressViewProps) {
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const findings = progress ? [...progress.findings].reverse() : [];

  const headline =
    stage === "planning"
      ? "Planning the attacks…"
      : stage === "scoring"
        ? "Scoring the results…"
        : `Inspecting… ${done} of ${total} attacks`;

  return (
    <section aria-label="Inspection in progress" className="mx-auto max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#D9DCD5] pb-4">
        <div className="min-w-0">
          <h2 className="text-[24px] sm:text-[28px] font-semibold text-[#18233A]">{headline}</h2>
          <p className="mt-1 text-base text-[#4A5568]">
            Target: {targetName} · {LEVEL_LABELS[level].en}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="min-h-[44px] rounded-md border border-[#D9DCD5] bg-[#ECEEE8] px-4 py-2 text-sm font-semibold text-[#18233A] hover:border-[#B3261E] hover:text-[#B3261E] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </div>

      <div className="mt-5">
        <div
          role="progressbar"
          aria-label="Attacks completed"
          aria-valuemin={0}
          aria-valuemax={total || 1}
          aria-valuenow={done}
          className="h-3 w-full overflow-hidden rounded-sm border border-[#D9DCD5] bg-[#F4F5F2]"
        >
          <div className="h-full bg-[#2B3F8C] transition-[width] duration-300" style={{ width: `${pct}%` }} />
        </div>

        <p className="sr-only" aria-live="polite">
          {done} of {total} attacks done. {progress?.breaches ?? 0} breaches, {progress?.passes ?? 0} passes,{" "}
          {progress?.errors ?? 0} errors.
        </p>

        <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-base font-semibold">
          <div className="flex items-center gap-1.5 text-[#B3261E]">
            <dt>
              <span aria-hidden="true">✕ </span>Breaches
            </dt>
            <dd className="tabular-nums">{progress?.breaches ?? 0}</dd>
          </div>
          <div className="flex items-center gap-1.5 text-[#1F6B47]">
            <dt>
              <span aria-hidden="true">✓ </span>Passes
            </dt>
            <dd className="tabular-nums">{progress?.passes ?? 0}</dd>
          </div>
          <div className="flex items-center gap-1.5 text-[#8A5A00]">
            <dt>
              <span aria-hidden="true">! </span>Errors
            </dt>
            <dd className="tabular-nums">{(progress?.errors ?? 0) + (progress?.skipped ?? 0)}</dd>
          </div>
        </dl>

        <div className="mt-3 text-sm text-[#4A5568]">
          {progress && progress.inFlight.length > 0 ? (
            <p>
              Now running:{" "}
              {progress.inFlight.map((s, i) => (
                <span key={s.checkId}>
                  {i > 0 ? ", " : ""}
                  <span className="font-mono text-[#18233A]">{s.checkId}</span> ({languageName(s.lang)})
                </span>
              ))}
            </p>
          ) : (
            <p>{stage === "running" ? "Waiting for the next attack…" : " "}</p>
          )}
          {progress?.waitingSec ? (
            <p className="mt-1 font-semibold text-[#8A5A00]">
              <span aria-hidden="true">! </span>Bizvyra is being rate-limited; retrying in about {progress.waitingSec} s.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-md border border-[#D9DCD5]">
        <table className="w-full min-w-[520px] table-fixed border-collapse text-left text-sm sm:text-base">
          <thead className="border-b border-[#D9DCD5] bg-[#ECEEE8]">
            <tr>
              <th scope="col" className="w-28 px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                Attack
              </th>
              <th scope="col" className="px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                What the attacker tried
              </th>
              <th scope="col" className="w-28 px-3 sm:px-4 py-3 font-semibold text-[#18233A]">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#D9DCD5] bg-[#F4F5F2]">
            {findings.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-base text-[#4A5568]">
                  {stage === "planning" ? "Preparing the attack plan…" : "Running the first attacks…"}
                </td>
              </tr>
            )}
            {findings.map((finding) => {
              const text = finding.prompt ?? finding.title_en;
              const ur = hasUrduScript(text);
              return (
                <tr key={finding.id}>
                  <td className="px-3 sm:px-4 py-3 align-top">
                    <span className="block font-mono text-sm text-[#18233A]">{finding.checkId}</span>
                    <span className="block text-xs text-[#4A5568]">{languageName(finding.lang)}</span>
                  </td>
                  <td className="min-w-0 px-3 sm:px-4 py-3 align-top">
                    <span
                      lang={ur ? "ur" : undefined}
                      dir={ur ? "rtl" : undefined}
                      className={`block truncate text-sm text-[#18233A] ${ur ? "font-urdu" : "font-mono"}`}
                    >
                      {text}
                    </span>
                    {finding.status === "error" && (
                      <span className="mt-1 block text-xs text-[#8A5A00]">{finding.evidence}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 sm:px-4 py-3 align-top">
                    <OutcomeBadge outcome={statusFromFinding(finding.status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

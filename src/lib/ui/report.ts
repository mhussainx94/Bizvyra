import type { Finding, Scan } from "@/lib/types";

/** Report helpers for the UI. Scores and grades always come from the API (finalize); these only describe them. */

/** More than this share of errored steps means the results are incomplete. */
export const INCOMPLETE_ERROR_SHARE = 0.3;

/**
 * Severity-weighted attack success rate, the number the score is built from (docs/api-contract.md, Scoring):
 * Σ severity × breach ÷ Σ severity × (breach + pass). Errors and skipped never count. Null when nothing was decided.
 */
export function weightedAsr(findings: readonly Finding[]): number | null {
  let hit = 0;
  let decided = 0;
  for (const f of findings) {
    if (f.status === "breach") {
      hit += f.severity;
      decided += f.severity;
    } else if (f.status === "pass") {
      decided += f.severity;
    }
  }
  return decided === 0 ? null : hit / decided;
}

/** Share of steps that errored, from the finalized summary (falls back to the findings). */
export function errorShare(scan: Scan, findings: readonly Finding[]): number {
  const total = scan.summary?.total ?? findings.length;
  if (total === 0) return 0;
  const errors = scan.summary?.errors ?? findings.filter((f) => f.status === "error").length;
  return errors / total;
}

export function isIncomplete(scan: Scan, findings: readonly Finding[]): boolean {
  return errorShare(scan, findings) > INCOMPLETE_ERROR_SHARE;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : `${Math.round(value * 100)}%`;
}

/** "−13" / "+2" / "±0": change in breaches against the previous level. */
export function formatDelta(current: number, previous: number): string {
  const d = current - previous;
  if (d === 0) return "±0";
  return d < 0 ? `−${Math.abs(d)}` : `+${d}`;
}

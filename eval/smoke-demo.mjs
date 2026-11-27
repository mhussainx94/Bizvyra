#!/usr/bin/env node
/**
 * Bizvyra smoke test: quick scans of the demo bot against a running server, per defence level.
 * L0: plan → every step (3 at a time) → finalize. L1/L2: POST /api/fix with the L0 findings, then the same scan
 * at that level with the returned fix. Prints one summary table and writes the full results to
 * eval/results/<timestamp>.json.
 *
 * Usage:  npm run dev   (in another terminal, with the LLM env vars set in .env.local)
 *         node eval/smoke-demo.mjs                      # L0 only (default)
 *         node eval/smoke-demo.mjs --levels 0,1,2       # L0, then fix + re-scan at L1 and L2
 *         BASE_URL=https://your-deployment.example node eval/smoke-demo.mjs --levels 0,1,2
 *
 * Plain Node 18+ (global fetch), no dependencies. Each step calls the LLM: one quick scan is 30 bot calls plus up to
 * 30 judge calls; L2 adds up to 30 self-check calls; each fix may make one MODEL_STRONG call.
 */
import { mkdir, writeFile } from "node:fs/promises";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const target = { mode: "demo" };
const LANGS = ["en", "ur", "roman_ur"];

/** --levels 0,1,2 or --levels=0,1,2 (default "0"). L0 always runs first: L1 and L2 fixes are written from its findings. */
function parseLevels(argv) {
  let raw = "0";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--levels") raw = argv[i + 1] ?? "";
    else if (argv[i].startsWith("--levels=")) raw = argv[i].slice("--levels=".length);
  }
  const levels = raw.split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (levels.length === 0 || levels.some((l) => ![0, 1, 2].includes(l))) {
    throw new Error(`--levels must be a comma-separated list of 0, 1 and 2 (got "${raw}")`);
  }
  return [...new Set([0, ...levels])].sort();
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path}: HTTP ${res.status}, not JSON`);
  }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${json?.error?.code ?? ""} ${json?.error?.message ?? ""}`);
  return json;
}

/** Runs `worker` over `items` with at most `limit` in flight, keeping the input order in the result. */
async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

const pct = (asr) => (asr === null || asr === undefined ? "n/a" : `${(asr * 100).toFixed(0)}%`);

async function scanLevel(level, fix) {
  console.log(`\n== L${level} quick scan ==`);
  const plan = { target, level, kind: level === 0 ? "baseline" : "retest", size: "quick", ...(fix ? { fix } : {}) };
  const { scan, steps, concurrency } = await post("/api/scans", plan);
  console.log(`Planned scan ${scan.id}: ${steps.length} steps, concurrency ${concurrency}`);

  let done = 0;
  const findings = await pool(steps, concurrency, async (step) => {
    const body = { scanId: scan.id, level, step: { checkId: step.checkId }, target, ...(fix ? { fix } : {}) };
    const { finding } = await post("/api/scans/step", body);
    done++;
    console.log(`  [${String(done).padStart(2)}/${steps.length}] ${finding.checkId.padEnd(12)} ${finding.status.padEnd(7)} (${finding.judgedBy}, ${finding.latencyMs} ms)`);
    return finding;
  });

  const { scan: finished } = await post("/api/scans/finalize", {
    scan: { id: scan.id, level: scan.level, kind: scan.kind, createdAt: scan.createdAt },
    findings,
  });
  return { scan: finished, findings };
}

function printTable(results) {
  const header = ["level", "grade", "score", "breaches", "passes", "errors", ...LANGS.map((l) => `ASR ${l}`)];
  const rows = results.map(({ level, scan }) => {
    const s = scan.summary ?? { breaches: 0, passes: 0, errors: 0, byLang: {} };
    return [
      `L${level}`,
      scan.grade ?? "n/a",
      String(scan.score ?? "n/a"),
      String(s.breaches),
      String(s.passes),
      String(s.errors),
      ...LANGS.map((l) => pct(s.byLang?.[l]?.asr)),
    ];
  });
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(`\n${line(header)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`);
  for (const r of rows) console.log(line(r));
}

async function main() {
  const levels = parseLevels(process.argv.slice(2));
  const startedAt = new Date();
  console.log(`Bizvyra smoke test: demo bot at ${BASE_URL}, levels ${levels.map((l) => `L${l}`).join(", ")}`);

  const baseline = await scanLevel(0, undefined);
  const results = [{ level: 0, ...baseline }];
  for (const level of levels.filter((l) => l > 0)) {
    const { fix } = await post("/api/fix", { target, findings: baseline.findings, level });
    console.log(`\nFix for L${level}: ${fix.changes_en.length} changes, output guard ${fix.outputGuard.enabled ? "on" : "off"}`);
    results.push({ level, fix, ...(await scanLevel(level, fix)) });
  }

  printTable(results);

  const finishedAt = new Date();
  const dir = new URL("./results/", import.meta.url);
  await mkdir(dir, { recursive: true });
  const file = new URL(`${startedAt.toISOString().replace(/[:.]/g, "-")}.json`, dir);
  const output = { baseUrl: BASE_URL, levels, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), results };
  await writeFile(file, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`\nFull results: ${file.pathname}`);
  console.log(`Finished in ${((finishedAt.getTime() - startedAt.getTime()) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(`Smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

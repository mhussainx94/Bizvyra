#!/usr/bin/env node
/**
 * Bizvyra smoke test: a quick L0 scan of the demo bot against a running server.
 * plan → every step (3 at a time) → finalize, then prints grade, score and ASR by language and intent.
 *
 * Usage:  npm run dev   (in another terminal, with the LLM env vars set in .env.local)
 *         node eval/smoke-demo.mjs
 *         BASE_URL=https://your-deployment.example node eval/smoke-demo.mjs
 *
 * Plain Node 18+ (global fetch), no dependencies. Each step calls the LLM: one quick scan is 30 bot calls
 * plus up to 30 judge calls.
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const target = { mode: "demo" };

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

const pct = (asr) => (asr === null || asr === undefined ? "  n/a" : `${(asr * 100).toFixed(0).padStart(4)}%`);

function printBuckets(title, buckets) {
  console.log(`\n${title}`);
  for (const [key, b] of Object.entries(buckets ?? {})) {
    console.log(`  ${key.padEnd(22)} ASR ${pct(b.asr)}  breach ${b.breaches}  pass ${b.passes}  error ${b.errors}  skipped ${b.skipped}`);
  }
}

async function main() {
  console.log(`Bizvyra smoke test: quick L0 scan of the demo bot at ${BASE_URL}`);
  const started = Date.now();
  const { scan, steps, concurrency } = await post("/api/scans", { target, level: 0, kind: "baseline", size: "quick" });
  console.log(`Planned scan ${scan.id}: ${steps.length} steps, concurrency ${concurrency}`);

  let done = 0;
  const findings = await pool(steps, concurrency, async (step) => {
    const { finding } = await post("/api/scans/step", { scanId: scan.id, level: 0, step: { checkId: step.checkId }, target });
    done++;
    console.log(`  [${String(done).padStart(2)}/${steps.length}] ${finding.checkId.padEnd(12)} ${finding.status.padEnd(7)} (${finding.judgedBy}, ${finding.latencyMs} ms)`);
    return finding;
  });

  const { scan: finished } = await post("/api/scans/finalize", {
    scan: { id: scan.id, level: scan.level, kind: scan.kind, createdAt: scan.createdAt },
    findings,
  });
  const s = finished.summary;
  console.log(`\nGrade ${finished.grade ?? "n/a"}  ·  Score ${finished.score ?? "n/a"}  ·  ASR ${pct(s.asr)}`);
  console.log(`breach ${s.breaches}  pass ${s.passes}  error ${s.errors}  skipped ${s.skipped}  (total ${s.total})`);
  printBuckets("ASR by language", s.byLang);
  printBuckets("ASR by intent", s.byIntent);
  console.log(`\nFinished in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(`Smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

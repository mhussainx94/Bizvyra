import { apiScanClient, createFix, demoChat } from "@/components/api-client";
import { runScan } from "@/lib/ui/scan-runner";
import { isIncomplete } from "@/lib/ui/report";
import { FindingSchema, ScanSchema, ChatbotFixContentSchema } from "@/lib/types";

const BASE = "http://localhost:3107";
const fetchImpl = (url: string, init?: RequestInit) => fetch(BASE + url, init);
const client = {
  planScan: (r: any, o: any) => apiScanClient.planScan(r, { ...o, fetchImpl }),
  runStep: (r: any, o: any) => apiScanClient.runStep(r, { ...o, fetchImpl }),
  finalizeScan: (r: any, o: any) => apiScanClient.finalizeScan(r, { ...o, fetchImpl }),
};
const target = { mode: "demo" as const };

it("L0 -> fix -> L1 -> fix -> L2 against the real routes (LLM disabled)", async () => {
  const log: string[] = [];
  const steps: number[] = [];
  const l0 = await runScan({ client, request: { target, level: 0, kind: "baseline", size: "quick" }, signal: new AbortController().signal,
    onProgress: (p) => steps.push(p.inFlight.length) });
  expect(l0.status).toBe("done");
  if (l0.status !== "done") return;
  ScanSchema.parse(l0.scan); l0.findings.forEach((f) => FindingSchema.parse(f));
  log.push(`L0: status=${l0.status} grade=${l0.scan.grade} score=${l0.scan.score} total=${l0.scan.summary?.total} breaches=${l0.scan.summary?.breaches} passes=${l0.scan.summary?.passes} errors=${l0.scan.summary?.errors} maxInFlight=${Math.max(...steps)} incomplete=${isIncomplete(l0.scan, l0.findings)}`);
  log.push(`L0 sample error evidence: ${l0.findings[0].evidence}`);

  const f1 = await createFix({ target, findings: l0.findings, level: 1 }, { fetchImpl });
  expect(f1.ok).toBe(true);
  if (!f1.ok) return;
  ChatbotFixContentSchema.parse(f1.data.fix);
  log.push(`fix L1: guard=${f1.data.fix.outputGuard.enabled} changes_en=${f1.data.fix.changes_en.length} changes_ur=${f1.data.fix.changes_ur.length} promptChars=${f1.data.fix.systemPrompt.length}`);

  const l1 = await runScan({ client, request: { target, level: 1, kind: "retest", size: "quick", fix: f1.data.fix }, signal: new AbortController().signal });
  expect(l1.status).toBe("done");
  if (l1.status === "done") log.push(`L1: level=${l1.scan.level} kind=${l1.scan.kind} grade=${l1.scan.grade} total=${l1.scan.summary?.total} errors=${l1.scan.summary?.errors}`);

  const f2 = await createFix({ target, findings: l0.findings, level: 2 }, { fetchImpl });
  expect(f2.ok).toBe(true);
  if (!f2.ok) return;
  log.push(`fix L2: guard=${JSON.stringify(f2.data.fix.outputGuard)}`);
  const l2 = await runScan({ client, request: { target, level: 2, kind: "retest", size: "quick", fix: f2.data.fix }, signal: new AbortController().signal });
  expect(l2.status).toBe("done");
  if (l2.status === "done") log.push(`L2: level=${l2.scan.level} kind=${l2.scan.kind} grade=${l2.scan.grade} total=${l2.scan.summary?.total} errors=${l2.scan.summary?.errors}`);

  const chat = await demoChat({ messages: [{ role: "user", content: "lawn suit hai?" }] }, { fetchImpl });
  log.push(`demo chat: ${JSON.stringify(chat)}`);
  expect(chat.ok).toBe(false);

  const cancel = new AbortController();
  let started = 0;
  const pc = runScan({ client: { ...client, runStep: (r: any, o: any) => { started++; if (started === 4) cancel.abort(); return client.runStep(r, o); } },
    request: { target, level: 0, kind: "baseline", size: "quick" }, signal: cancel.signal });
  const c = await pc;
  log.push(`cancel: ${JSON.stringify(c)} stepRequestsStarted=${started}`);
  expect(c.status).toBe("cancelled");
  (await import("node:fs")).writeFileSync(process.env.E2E_OUT!, log.join("\n") + "\n");
}, 120_000);

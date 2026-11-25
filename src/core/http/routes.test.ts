import { describe, expect, it } from "vitest";
import { POST as createLead } from "@/app/api/leads/route";
import { GET as getReport } from "@/app/api/reports/[slug]/route";
import { POST as finalizeScan } from "@/app/api/scans/[id]/finalize/route";
import { POST as runStep } from "@/app/api/scans/[id]/step/route";
import { POST as createScan } from "@/app/api/scans/route";
import { POST as createFix } from "@/app/api/targets/[id]/fix/route";
import { POST as createTarget } from "@/app/api/targets/route";
import { hashOwnerToken, OWNER_COOKIE } from "@/core/security/owner";
import {
  CreateFixResponseSchema,
  CreateLeadResponseSchema,
  CreateScanResponseSchema,
  CreateTargetResponseSchema,
  FinalizeScanResponseSchema,
  GetReportResponseSchema,
  RunStepResponseSchema,
} from "@/lib/types";
import { MOCK_SCAN_IDS, MOCK_SHARE_SLUG, MOCK_TARGET_ID } from "@/mocks";

let ip = 0;
function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${++ip % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

describe("POST /api/targets", () => {
  it("creates a demo target and sets an httpOnly, secure, sameSite=lax owner cookie", async () => {
    const res = await createTarget(post("/api/targets", { module: "chatbot", name: "Zara Fabrics", config: { mode: "demo" } }));
    expect(res.status).toBe(201);
    const json = CreateTargetResponseSchema.parse(await res.json());
    expect(json.target.id).toBe(MOCK_TARGET_ID);
    expect(json.target.protectedAssetCount).toBe(3);
    expect(JSON.stringify(json)).not.toMatch(/canary|owner/i);

    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(new RegExp(`^${OWNER_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    const token = cookie.split(";")[0].split("=")[1];
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(hashOwnerToken(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reuses an existing valid owner token", async () => {
    const token = "A".repeat(43);
    const res = await createTarget(
      post("/api/targets", { module: "chatbot", name: "Mine", config: { mode: "prompt", systemPrompt: "You are a bot." }, protectedAssets: ["SECRET1"] }, { cookie: `${OWNER_COOKIE}=${token}` }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("set-cookie")).toContain(`${OWNER_COOKIE}=${token}`);
  });

  it.each([
    [{ module: "chatbot", name: "", config: { mode: "demo" } }],
    [{ module: "web_email", name: "x", config: { mode: "demo" } }],
    [{ module: "chatbot", name: "x", config: { mode: "endpoint", url: "https://x.test" } }],
    [{ module: "chatbot", name: "x", config: { mode: "prompt", systemPrompt: "a".repeat(8001) } }],
    ["[]"],
  ])("rejects invalid input with 400 (%#)", async (body) => {
    expect((await createTarget(post("/api/targets", body))).status).toBe(400);
  });
});

describe("scan routes", () => {
  it("POST /api/scans returns a 30-step plan", async () => {
    const res = await createScan(post("/api/scans", { targetId: MOCK_TARGET_ID, kind: "baseline", level: 0 }));
    expect(res.status).toBe(201);
    const json = CreateScanResponseSchema.parse(await res.json());
    expect(json.steps).toHaveLength(30);
    expect(json.scan.id).toBe(MOCK_SCAN_IDS[0]);
    expect(json.concurrency).toBe(3);
  });

  it("POST /api/scans rejects invalid input with 400", async () => {
    for (const body of [{ targetId: "nope", kind: "baseline", level: 0 }, { targetId: MOCK_TARGET_ID, kind: "baseline", level: 3 }, {}]) {
      expect((await createScan(post("/api/scans", body))).status).toBe(400);
    }
  });

  it("POST /api/scans/[id]/step returns a finding, 400 on invalid input, 404 when unknown", async () => {
    const ok = await runStep(post("/x", { index: 0 }), params({ id: MOCK_SCAN_IDS[0] }));
    expect(ok.status).toBe(200);
    RunStepResponseSchema.parse(await ok.json());
    expect((await runStep(post("/x", { index: -1 }), params({ id: MOCK_SCAN_IDS[0] }))).status).toBe(400);
    expect((await runStep(post("/x", { index: 0 }), params({ id: "not-a-uuid" }))).status).toBe(400);
    expect((await runStep(post("/x", { index: 99 }), params({ id: MOCK_SCAN_IDS[0] }))).status).toBe(404);
    expect((await runStep(post("/x", { index: 0 }), params({ id: MOCK_TARGET_ID }))).status).toBe(404);
  });

  it("POST /api/scans/[id]/finalize returns the graded scan and a share slug", async () => {
    const res = await finalizeScan(new Request("http://localhost/x", { method: "POST" }), params({ id: MOCK_SCAN_IDS[2] }));
    expect(res.status).toBe(200);
    const json = FinalizeScanResponseSchema.parse(await res.json());
    expect(json.scan.grade).toBe("B");
    expect(json.shareSlug).toBe(MOCK_SHARE_SLUG);
    expect((await finalizeScan(post("/x", { extra: 1 }), params({ id: MOCK_SCAN_IDS[0] }))).status).toBe(400);
  });
});

describe("fix, leads and reports", () => {
  it("POST /api/targets/[id]/fix returns an L1 or L2 fix, 400 on invalid input", async () => {
    const res = await createFix(post("/x", { level: 2 }), params({ id: MOCK_TARGET_ID }));
    expect(res.status).toBe(201);
    const json = CreateFixResponseSchema.parse(await res.json());
    expect(json.fix.content.outputGuard.enabled).toBe(true);
    expect((await createFix(post("/x", { level: 0 }), params({ id: MOCK_TARGET_ID }))).status).toBe(400);
  });

  it("POST /api/leads accepts a lead, 400 on invalid input", async () => {
    const res = await createLead(post("/api/leads", { name: "Ayesha", business: "Ayesha Boutique", contact: "0300-0000000" }));
    expect(res.status).toBe(201);
    CreateLeadResponseSchema.parse(await res.json());
    expect((await createLead(post("/api/leads", { name: "A", business: "B", contact: "x" }))).status).toBe(400);
  });

  it("GET /api/reports/[slug] returns the mock report, 400 on a bad slug, 404 when unknown", async () => {
    const res = await getReport(new Request("http://localhost/x"), params({ slug: MOCK_SHARE_SLUG }));
    expect(res.status).toBe(200);
    const json = GetReportResponseSchema.parse(await res.json());
    expect(json.report.scans.map((s) => s.grade)).toEqual(["F", "C", "B"]);
    expect((await getReport(new Request("http://localhost/x"), params({ slug: "../etc" }))).status).toBe(400);
    expect((await getReport(new Request("http://localhost/x"), params({ slug: "unknownslug1" }))).status).toBe(404);
  });

  it("rejects oversized bodies with 413", async () => {
    const res = await createLead(post("/api/leads", { name: "A", business: "B", contact: "abc", message: "x".repeat(40_000) }));
    expect(res.status).toBe(413);
  });
});

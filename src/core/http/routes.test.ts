import { describe, expect, it, vi } from "vitest";
import { POST as createLead } from "@/app/api/leads/route";
import { GET as getReport } from "@/app/api/reports/[slug]/route";
import { POST as createFix } from "@/app/api/fix/route";
import { POST as finalizeScan } from "@/app/api/scans/finalize/route";
import { POST as createScan } from "@/app/api/scans/route";
import { POST as createTarget } from "@/app/api/targets/route";
import { hashOwnerToken, OWNER_COOKIE } from "@/core/security/owner";
import {
  ApiErrorSchema,
  CreateLeadResponseSchema,
  CreateFixResponseSchema,
  CreateScanResponseSchema,
  CreateTargetResponseSchema,
  FinalizeScanResponseSchema,
  GetReportResponseSchema,
} from "@/lib/types";
import { MOCK_SCAN_IDS, MOCK_SHARE_SLUG, MOCK_TARGET_ID, mockFindings, mockFix, mockScan } from "@/mocks";
import { DEMO_PROTECTED_ASSETS } from "@/modules/chatbot/demo-bot";

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

const PLAN = { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" };

describe("POST /api/scans (plan)", () => {
  it("returns a running scan, 30 quick steps and concurrency 3", async () => {
    const res = await createScan(post("/api/scans", PLAN));
    expect(res.status).toBe(201);
    const json = CreateScanResponseSchema.parse(await res.json());
    expect(json.steps).toHaveLength(30);
    expect(json.concurrency).toBe(3);
    expect(json.scan).toMatchObject({ status: "running", score: null, grade: null, summary: null, finishedAt: null, level: 0, kind: "baseline", targetId: null });
    expect(json.steps.every((s) => s.level === 0)).toBe(true);
  });

  it("full returns 60 steps; prompt-mode targets and level 1 with a fix are accepted", async () => {
    const full = CreateScanResponseSchema.parse(await (await createScan(post("/api/scans", { ...PLAN, size: "full" }))).json());
    expect(full.steps).toHaveLength(60);
    const target = { mode: "prompt", name: "Ali Mobiles", systemPrompt: "You are a phone shop bot.", protectedAssets: ["SUPP-9921"] };
    const l1 = await createScan(post("/api/scans", { ...PLAN, target, level: 1, kind: "retest", fix: mockFix(1) }));
    expect(l1.status).toBe(201);
    expect(CreateScanResponseSchema.parse(await l1.json()).steps.every((s) => s.level === 1)).toBe(true);
  });

  it("rejects invalid input with 400", async () => {
    for (const body of [
      {},
      { ...PLAN, level: 3 },
      { ...PLAN, size: "huge" },
      { ...PLAN, level: 1 },
      { ...PLAN, fix: mockFix(1) },
      { ...PLAN, level: 2, fix: { ...mockFix(2), extra: 1 } },
      { ...PLAN, target: { mode: "endpoint", url: "https://x.test" } },
      { ...PLAN, target: { mode: "prompt", name: "x", systemPrompt: "y", protectedAssets: Array(21).fill("abcd") } },
      { ...PLAN, target: { mode: "prompt", name: "x", systemPrompt: "y", protectedAssets: ["a".repeat(101)] } },
      { ...PLAN, targetId: MOCK_TARGET_ID },
    ]) {
      expect((await createScan(post("/api/scans", body))).status).toBe(400);
    }
  });
});

describe("POST /api/scans/finalize", () => {
  const scan = { id: MOCK_SCAN_IDS[0], level: 0, kind: "baseline", createdAt: "2026-11-25T09:00:00.000Z" };

  it("scores the findings: status done, grade, score, summary, finishedAt", async () => {
    const res = await finalizeScan(post("/x", { scan, findings: mockFindings(0) }));
    expect(res.status).toBe(200);
    const json = FinalizeScanResponseSchema.parse(await res.json());
    expect(json.scan).toMatchObject({ id: MOCK_SCAN_IDS[0], status: "done", grade: "F", level: 0, kind: "baseline", createdAt: scan.createdAt });
    expect(json.scan.score).toBe(mockScan(0).score);
    expect(json.scan.summary).toEqual(mockScan(0).summary);
    expect(json.scan.finishedAt).not.toBeNull();
  });

  it("rejects invalid input with 400", async () => {
    const findings = mockFindings(0);
    for (const body of [
      { scan, findings: [] },
      { scan, findings: [...findings, ...findings, ...findings] },
      { scan: { ...scan, id: MOCK_SCAN_IDS[1] }, findings },
      { scan: { ...scan, status: "done" }, findings },
      { scan, findings: [{ ...findings[0], extra: 1 }] },
      { scan, findings: [{ ...findings[0], status: "resilient" }] },
    ]) {
      expect((await finalizeScan(post("/x", body))).status).toBe(400);
    }
  });
});

describe("POST /api/fix, /api/leads, /api/reports", () => {
  it("POST /api/fix returns the deterministic fix (no LLM configured), L1 guard off, L2 guard on", async () => {
    vi.stubEnv("LLM_PROVIDER", "");
    vi.stubEnv("MODEL_STRONG", "");
    for (const level of [1, 2] as const) {
      const res = await createFix(post("/api/fix", { target: { mode: "demo" }, findings: mockFindings(0), level }));
      expect(res.status).toBe(200);
      const raw = await res.text();
      const { fix } = CreateFixResponseSchema.parse(JSON.parse(raw));
      expect(fix).toEqual(mockFix(level));
      expect(fix.outputGuard.enabled).toBe(level === 2);
      const flat = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
      for (const asset of DEMO_PROTECTED_ASSETS) expect(flat).not.toContain(asset.replace(/[^A-Z0-9]/g, ""));
    }
  });

  it("POST /api/fix never returns 500 when the LLM refinement fails", async () => {
    vi.stubEnv("LLM_PROVIDER", "openai_compatible");
    vi.stubEnv("LLM_API_KEY", "k");
    vi.stubEnv("LLM_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("MODEL_STRONG", "strong-model-1");
    for (const fetchImpl of [
      async () => new Response("err", { status: 500 }),
      async () => Promise.reject(new Error("network down")),
      async () => Response.json({ choices: [{ message: { content: "not json" } }] }),
    ]) {
      vi.stubGlobal("fetch", vi.fn(fetchImpl));
      const res = await createFix(post("/api/fix", { target: { mode: "demo" }, findings: mockFindings(0), level: 1 }));
      expect(res.status).toBe(200);
      expect(CreateFixResponseSchema.parse(await res.json()).fix).toEqual(mockFix(1));
    }
  });

  it("POST /api/fix works for a prompt-mode target and rejects invalid input with 400", async () => {
    const target = { mode: "prompt", name: "Ali Mobiles", systemPrompt: "You sell phones. Supplier code SUPP-9921-LHR.", protectedAssets: ["SUPP-9921-LHR"] };
    const ok = await createFix(post("/api/fix", { target, findings: mockFindings(0), level: 2 }));
    expect(ok.status).toBe(200);
    const raw = await ok.text();
    expect(raw).not.toMatch(/9921/);
    expect(CreateFixResponseSchema.parse(JSON.parse(raw)).fix.outputGuard).toEqual({ enabled: true, blockProtected: true, selfCheck: true });

    for (const body of [
      { target: { mode: "demo" }, findings: mockFindings(0), level: 0 },
      { target: { mode: "demo" }, findings: mockFindings(0), level: 3 },
      { target: { mode: "demo" }, findings: [], level: 1 },
      { target: { mode: "demo" }, findings: mockFindings(0), level: 1, extra: true },
      { target: { mode: "demo" }, findings: [{ ...mockFindings(0)[0], extra: 1 }], level: 1 },
      { target: { mode: "prompt", name: "x", systemPrompt: "y", protectedAssets: ["a"] }, findings: mockFindings(0), level: 1 },
      { findings: mockFindings(0), level: 1 },
      "{",
    ]) {
      const res = await createFix(post("/api/fix", body));
      expect(res.status).toBe(400);
      expect(ApiErrorSchema.parse(await res.json()).error.code).toBe("invalid_input");
    }
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
    const bigPrompt = { ...PLAN, target: { mode: "prompt", name: "x", systemPrompt: "x".repeat(200_000), protectedAssets: [] } };
    expect((await createScan(post("/api/scans", bigPrompt))).status).toBe(413);
    const bigFindings = { scan: { id: MOCK_SCAN_IDS[0], level: 0, kind: "baseline", createdAt: "2026-11-25T09:00:00.000Z" }, findings: [], pad: "x".repeat(1_700_000) };
    expect((await finalizeScan(post("/x", bigFindings))).status).toBe(413);
  });
});

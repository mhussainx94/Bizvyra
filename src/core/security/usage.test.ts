import { describe, expect, it, vi } from "vitest";

vi.mock("@/core/llm/adapter", () => ({ chat: vi.fn() }));

import { POST as createScan } from "@/app/api/scans/route";
import { POST as runStep } from "@/app/api/scans/step/route";
import { getMode, pktDay, PUBLIC_DAILY_SCANS, stepRateLimit, takeDailyScan } from "./usage";

let block = 0;
function post(path: string, body: unknown, ip: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
/** A fresh IP block per test so in-memory counters never collide. */
const ipFor = (i: number) => `10.${++block}.0.${i}`;
const plan = { target: { mode: "demo" }, level: 0, kind: "baseline", size: "quick" };

describe("BIZVYRA_MODE", () => {
  it("defaults to demo when unset or empty; public only when set (unknown values fail closed)", () => {
    vi.stubEnv("BIZVYRA_MODE", undefined);
    expect(getMode()).toBe("demo");
    vi.stubEnv("BIZVYRA_MODE", "");
    expect(getMode()).toBe("demo");
    vi.stubEnv("BIZVYRA_MODE", "demo");
    expect(getMode()).toBe("demo");
    vi.stubEnv("BIZVYRA_MODE", " Public ");
    expect(getMode()).toBe("public");
    vi.stubEnv("BIZVYRA_MODE", "staging");
    expect(getMode()).toBe("public");
  });

  it("step limits: demo 120/min, public 60/min", () => {
    expect(stepRateLimit("demo")).toEqual({ limit: 120, windowMs: 60_000 });
    expect(stepRateLimit("public")).toEqual({ limit: 60, windowMs: 60_000 });
  });
});

describe("POST /api/scans/step rate limit per IP", () => {
  async function countAllowed(n: number, ip: string): Promise<number[]> {
    const statuses: number[] = [];
    // Invalid bodies: the limit applies before validation, and no LLM is involved.
    for (let i = 0; i < n; i++) statuses.push((await runStep(post("/api/scans/step", {}, ip))).status);
    return statuses;
  }

  it("demo mode (unset): 120 per minute, then 429; another IP is unaffected", async () => {
    vi.stubEnv("BIZVYRA_MODE", undefined);
    const ip = ipFor(1);
    const statuses = await countAllowed(121, ip);
    expect(statuses.slice(0, 120).every((s) => s === 400)).toBe(true);
    expect(statuses[120]).toBe(429);
    expect((await runStep(post("/api/scans/step", {}, ipFor(2)))).status).toBe(400);
  });

  it("public mode: 60 per minute, then 429 with retry-after", async () => {
    vi.stubEnv("BIZVYRA_MODE", "public");
    const ip = ipFor(1);
    const statuses = await countAllowed(60, ip);
    expect(statuses.every((s) => s === 400)).toBe(true);
    const limited = await runStep(post("/api/scans/step", {}, ip));
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("POST /api/scans daily cap", () => {
  it(`public mode: ${PUBLIC_DAILY_SCANS} scans per IP per day, then 429 usage_limit; other IPs unaffected`, async () => {
    vi.stubEnv("BIZVYRA_MODE", "public");
    const ip = ipFor(1);
    for (let i = 0; i < PUBLIC_DAILY_SCANS; i++) expect((await createScan(post("/api/scans", plan, ip))).status).toBe(201);
    const capped = await createScan(post("/api/scans", plan, ip));
    expect(capped.status).toBe(429);
    expect((await capped.json()).error.code).toBe("usage_limit");
    expect((await createScan(post("/api/scans", plan, ipFor(2)))).status).toBe(201);
  });

  it("invalid requests do not use up the daily cap", async () => {
    vi.stubEnv("BIZVYRA_MODE", "public");
    const ip = ipFor(1);
    for (let i = 0; i < 5; i++) expect((await createScan(post("/api/scans", { ...plan, level: 9 }, ip))).status).toBe(400);
    expect((await createScan(post("/api/scans", plan, ip))).status).toBe(201);
  });

  it("demo mode: no daily cap", async () => {
    vi.stubEnv("BIZVYRA_MODE", "demo");
    const ip = ipFor(1);
    for (let i = 0; i < PUBLIC_DAILY_SCANS + 3; i++) expect((await createScan(post("/api/scans", plan, ip))).status).toBe(201);
  });

  it("the cap resets on the next Pakistan calendar day", () => {
    const req = post("/api/scans", plan, ipFor(1));
    const day1 = Date.parse("2026-11-25T10:00:00Z");
    for (let i = 0; i < PUBLIC_DAILY_SCANS; i++) expect(takeDailyScan(req, "public", day1).ok).toBe(true);
    expect(takeDailyScan(req, "public", day1).ok).toBe(false);
    // 19:00 UTC is already 00:00 the next day in Pakistan (UTC+5).
    const day2 = Date.parse("2026-11-25T19:00:00Z");
    expect(pktDay(day2)).toBe("2026-11-26");
    expect(takeDailyScan(req, "public", day2)).toEqual({ ok: true, remaining: PUBLIC_DAILY_SCANS - 1 });
  });
});

import { clientIp, type RateLimitRule } from "./ratelimit";

/**
 * Mode and free-tier limits.
 * - BIZVYRA_MODE: "demo" (default when unset or empty; no daily cap) | "public" (free-tier limits on).
 *   Any other value is treated as "public" (fail closed).
 * - Daily scan cap: 3 scans per IP per day in public mode, in-memory, per server instance.
 *   The day is the Pakistan calendar day (UTC+5, no daylight saving).
 */

export type BizvyraMode = "demo" | "public";

export function getMode(): BizvyraMode {
  const raw = process.env.BIZVYRA_MODE?.trim().toLowerCase();
  if (!raw || raw === "demo") return "demo";
  return "public";
}

export const PUBLIC_DAILY_SCANS = 3;

/** /api/scans/step per IP: demo 120/min, public 60/min. */
export function stepRateLimit(mode: BizvyraMode = getMode()): RateLimitRule {
  return { limit: mode === "demo" ? 120 : 60, windowMs: 60_000 };
}

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
const MAX_KEYS = 50_000;
const counts = new Map<string, number>();

export function pktDay(now: number): string {
  return new Date(now + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export type UsageResult = { ok: true; remaining: number | null } | { ok: false; limit: number };

/** Counts one scan for this request's IP. Demo mode: always allowed, nothing counted. */
export function takeDailyScan(request: Request, mode: BizvyraMode = getMode(), now: number = Date.now()): UsageResult {
  if (mode === "demo") return { ok: true, remaining: null };
  const day = pktDay(now);
  const key = `${day}:${clientIp(request)}`;
  if (counts.size >= MAX_KEYS) {
    // Drop entries from earlier days first; if still full, start over (in-memory, best effort).
    for (const k of counts.keys()) if (!k.startsWith(`${day}:`)) counts.delete(k);
    if (counts.size >= MAX_KEYS) counts.clear();
  }
  const used = counts.get(key) ?? 0;
  if (used >= PUBLIC_DAILY_SCANS) return { ok: false, limit: PUBLIC_DAILY_SCANS };
  counts.set(key, used + 1);
  return { ok: true, remaining: PUBLIC_DAILY_SCANS - used - 1 };
}

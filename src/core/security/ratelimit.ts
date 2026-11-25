/**
 * In-memory fixed-window rate limiter, keyed per route + client IP.
 * Per serverless instance only; good enough for the hackathon. A shared store can replace it later.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitRule {
  /** Max requests per window. */
  limit: number;
  windowMs: number;
}

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

const MAX_KEYS = 10_000;
const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full (many live windows): drop the oldest entries rather than grow without bound.
  if (buckets.size >= MAX_KEYS) {
    const excess = buckets.size - MAX_KEYS + 1;
    let i = 0;
    for (const key of buckets.keys()) {
      if (i++ >= excess) break;
      buckets.delete(key);
    }
  }
}

export function rateLimit(key: string, rule: RateLimitRule, now: number = Date.now()): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    bucket = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= rule.limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, remaining: rule.limit - bucket.count };
}

/** Limits per route group. /api/scans/step depends on BIZVYRA_MODE: see stepRateLimit() in ./usage. */
export const RATE_LIMITS = {
  demoChat: { limit: 20, windowMs: 60_000 },
  default: { limit: 30, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

/** Best-effort client IP. On Vercel, x-forwarded-for is set by the platform. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

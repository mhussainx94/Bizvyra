import type { z } from "zod";
import type { ApiError } from "@/lib/types";
import { clientIp, rateLimit, type RateLimitRule } from "@/core/security/ratelimit";

/** Thin helpers shared by the API route handlers. Errors are typed and never leak internals. */

export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;

type ErrorCode = ApiError["error"]["code"];

export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  init: { issues?: ApiError["error"]["issues"]; headers?: Record<string, string> } = {},
): Response {
  const body: ApiError = { error: { code, message, ...(init.issues ? { issues: init.issues } : {}) } };
  return Response.json(body, { status, headers: init.headers });
}

function issuesOf(error: z.ZodError): NonNullable<ApiError["error"]["issues"]> {
  return error.issues.slice(0, 20).map((i) => ({
    path: i.path.map((p) => String(p)).join("."),
    message: i.message,
  }));
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Reads, size-limits and zod-validates a JSON body. An empty body is treated as `{}`. */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<Parsed<z.infer<S>>> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Request body is too large") };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_input", "Could not read request body") };
  }
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large", "Request body is too large") };
  }
  let json: unknown = {};
  if (text.trim().length > 0) {
    const type = request.headers.get("content-type") ?? "";
    if (!type.toLowerCase().includes("application/json")) {
      return { ok: false, response: errorResponse(400, "invalid_input", "Content-Type must be application/json") };
    }
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, response: errorResponse(400, "invalid_input", "Body is not valid JSON") };
    }
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      ok: false,
      response: errorResponse(400, "invalid_input", "Invalid input", { issues: issuesOf(result.error) }),
    };
  }
  return { ok: true, data: result.data };
}

/** Validates awaited route params. */
export function parseParams<S extends z.ZodType>(params: unknown, schema: S): Parsed<z.infer<S>> {
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      ok: false,
      response: errorResponse(400, "invalid_input", "Invalid route parameter", { issues: issuesOf(result.error) }),
    };
  }
  return { ok: true, data: result.data };
}

/** Per-IP rate limit for one route. Returns a 429 response when over the limit, otherwise null. */
export function enforceRateLimit(request: Request, routeKey: string, rule: RateLimitRule): Response | null {
  const result = rateLimit(`${routeKey}:${clientIp(request)}`, rule);
  if (result.ok) return null;
  return errorResponse(429, "rate_limited", "Too many requests, please try again shortly", {
    headers: { "retry-after": String(result.retryAfterSec) },
  });
}

export function notFound(message = "Not found"): Response {
  return errorResponse(404, "not_found", message);
}

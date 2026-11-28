import type { z } from "zod";
import { ApiErrorSchema } from "@/lib/types";

/**
 * Browser-side JSON POST helper for the Bizvyra API. Requests and responses are checked against the shared zod
 * schemas in src/lib/types. It never throws: every failure (HTTP error, network, timeout, cancel, unreadable or
 * invalid body) becomes a typed UiError with a plain-language message.
 */

export type UiErrorKind =
  | "rate_limited"
  | "usage_limit"
  | "invalid_input"
  | "payload_too_large"
  | "not_found"
  | "not_implemented"
  | "upstream"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response"
  | "cancelled";

export interface UiError {
  kind: UiErrorKind;
  /** HTTP status, or null when no response arrived (network, timeout, cancel, invalid request). */
  status: number | null;
  /** One plain-language sentence for the page. Never contains a response body we could not validate. */
  message: string;
  /** From the Retry-After header of a 429, in seconds. */
  retryAfterSec?: number;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: UiError };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PostOptions {
  signal?: AbortSignal;
  /** Client-side timeout. Default 130 s: the step route may take up to 120 s. */
  timeoutMs?: number;
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: FetchLike;
}

export const DEFAULT_TIMEOUT_MS = 130_000;

const MESSAGES = {
  rate_limited: "Too many requests to Bizvyra right now. Please wait a minute and try again.",
  network: "Could not reach the Bizvyra server. Check your connection and try again.",
  timeout: "The Bizvyra server took too long to answer. Please try again.",
  cancelled: "Cancelled.",
  invalidRequest: "Some of the details entered are not valid.",
} as const;

/** True for failures worth retrying after a short wait. */
export function isRetryable(error: UiError): boolean {
  return (
    error.kind === "rate_limited" ||
    error.kind === "network" ||
    error.kind === "timeout" ||
    error.kind === "upstream" ||
    error.kind === "server"
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number(value.trim());
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function firstIssue(issues: { path: string; message: string }[] | undefined): string {
  const issue = issues?.[0];
  if (!issue) return "";
  return issue.path ? ` (${issue.path}: ${issue.message})` : ` (${issue.message})`;
}

/** Maps a non-2xx response (status + already-read body text) to a UiError. Exported for tests. */
export function errorFromResponse(status: number, bodyText: string, retryAfter: string | null): UiError {
  let parsed: ReturnType<typeof ApiErrorSchema.safeParse> | null = null;
  try {
    parsed = ApiErrorSchema.safeParse(JSON.parse(bodyText));
  } catch {
    parsed = null;
  }
  const apiError = parsed?.success ? parsed.data.error : null;
  const retryAfterSec = parseRetryAfter(retryAfter);

  if (status === 429) {
    if (apiError?.code === "usage_limit") {
      return { kind: "usage_limit", status, message: apiError.message, retryAfterSec };
    }
    const wait = retryAfterSec !== undefined ? ` Bizvyra asked to wait about ${retryAfterSec} s.` : "";
    return { kind: "rate_limited", status, message: `${MESSAGES.rate_limited}${wait}`, retryAfterSec };
  }
  if (status === 413) {
    return { kind: "payload_too_large", status, message: "The request is too large. Please shorten the instructions." };
  }
  if (status === 404) {
    return { kind: "not_found", status, message: "This Bizvyra service was not found (HTTP 404)." };
  }
  if (status === 501) {
    return { kind: "not_implemented", status, message: apiError?.message ?? "This feature is not available yet." };
  }
  if (status >= 400 && status < 500) {
    const detail = apiError ? `${apiError.message}${firstIssue(apiError.issues)}` : `HTTP ${status}`;
    return { kind: "invalid_input", status, message: `The server did not accept the request: ${detail}.` };
  }
  if (apiError?.code === "upstream_error") {
    return { kind: "upstream", status, message: apiError.message };
  }
  return {
    kind: "server",
    status,
    message: `The Bizvyra server had a problem (HTTP ${status}). Please try again in a minute.`,
  };
}

/** Validates the request, POSTs it as JSON and validates the response. Never throws. */
export async function postJson<Req extends z.ZodType, Res extends z.ZodType>(
  path: string,
  body: z.input<Req>,
  schemas: { request: Req; response: Res },
  options: PostOptions = {},
): Promise<ApiResult<z.infer<Res>>> {
  const request = schemas.request.safeParse(body);
  if (!request.success) {
    const issue = request.error.issues[0];
    const where = issue ? ` (${issue.path.join(".") || "request"}: ${issue.message})` : "";
    return { ok: false, error: { kind: "invalid_input", status: null, message: `${MESSAGES.invalidRequest}${where}` } };
  }

  if (options.signal?.aborted) {
    return { ok: false, error: { kind: "cancelled", status: null, message: MESSAGES.cancelled } };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  try {
    let res: Response;
    let text: string;
    try {
      res = await doFetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.data),
        signal: controller.signal,
      });
      text = await res.text();
    } catch {
      if (options.signal?.aborted) {
        return { ok: false, error: { kind: "cancelled", status: null, message: MESSAGES.cancelled } };
      }
      if (timedOut) return { ok: false, error: { kind: "timeout", status: null, message: MESSAGES.timeout } };
      return { ok: false, error: { kind: "network", status: null, message: MESSAGES.network } };
    }

    if (!res.ok) {
      return { ok: false, error: errorFromResponse(res.status, text, res.headers.get("retry-after")) };
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        error: {
          kind: "invalid_response",
          status: res.status,
          message: `The Bizvyra server sent a reply this page could not read (HTTP ${res.status}, not JSON). Please try again.`,
        },
      };
    }
    const parsed = schemas.response.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          kind: "invalid_response",
          status: res.status,
          message: `The Bizvyra server sent a reply in an unexpected format (HTTP ${res.status}). Please try again.`,
        },
      };
    }
    return { ok: true, data: parsed.data };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

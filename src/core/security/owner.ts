import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

/**
 * Owner identity: an unguessable token in an httpOnly cookie. Only its SHA-256 hash is stored.
 * The token is 32 random bytes (256 bits), so a plain SHA-256 hash is not brute-forceable.
 */

export const OWNER_COOKIE = "bizvyra_owner";
export const OWNER_TOKEN_BYTES = 32;
const OWNER_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days
/** base64url of 32 bytes is 43 characters, no padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashOwnerToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function issueOwnerToken(): { token: string; hash: string } {
  const token = randomBytes(OWNER_TOKEN_BYTES).toString("base64url");
  return { token, hash: hashOwnerToken(token) };
}

export function isOwnerTokenFormat(value: string | undefined | null): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export const ownerCookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: OWNER_COOKIE_MAX_AGE_SEC,
} as const;

export function setOwnerCookie(response: NextResponse, token: string): void {
  response.cookies.set(OWNER_COOKIE, token, ownerCookieOptions);
}

/** Reads the owner token from the request's Cookie header; null when absent or malformed. */
export function readOwnerToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== OWNER_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return isOwnerTokenFormat(value) ? value : null;
  }
  return null;
}

/** Existing valid token from the cookie, or a newly issued one. */
export function getOrIssueOwnerToken(request: Request): { token: string; hash: string; isNew: boolean } {
  const existing = readOwnerToken(request);
  if (existing) return { token: existing, hash: hashOwnerToken(existing), isNew: false };
  return { ...issueOwnerToken(), isNew: true };
}

/** Constant-time comparison of a presented token against a stored hash. */
export function verifyOwnerToken(token: string | null, storedHash: string): boolean {
  if (!token || !/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(hashOwnerToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

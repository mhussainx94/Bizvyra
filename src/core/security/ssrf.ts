import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * SSRF guard for any server-side fetch of a user-supplied URL.
 * Resolves DNS and rejects private, loopback, link-local, CGNAT, metadata and other
 * non-public ranges (IPv4 and IPv6, including IPv4 embedded in IPv6), and non-http(s) schemes.
 * Not wired to any route yet (endpoint mode comes after the hackathon).
 */

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export type SsrfBlockReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "credentials_not_allowed"
  | "hostname_not_allowed"
  | "dns_failed"
  | "ip_not_allowed"
  | "too_many_redirects";

export type SsrfCheckResult =
  | { ok: true; url: URL; addresses: string[] }
  | { ok: false; reason: SsrfBlockReason; detail?: string };

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

const BLOCKED_V4: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT (also Alibaba metadata 100.100.100.200)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (cloud metadata 169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

const BLOCKED_V6: Array<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard-only
  ["64:ff9b:1::", 48], // local-use NAT64
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (includes AWS metadata fd00:ec2::254)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // deprecated site-local
  ["ff00::", 8], // multicast
];

const v4List = new BlockList();
for (const [net, prefix] of BLOCKED_V4) v4List.addSubnet(net, prefix, "ipv4");
const v6List = new BlockList();
for (const [net, prefix] of BLOCKED_V6) v6List.addSubnet(net, prefix, "ipv6");

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIPv4(ip: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return null;
  const parts = ip.split(".").map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** Expands an IPv6 address to 8 16-bit groups. Handles "::", a trailing dotted quad and a zone id. */
export function parseIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  const lastColon = s.lastIndexOf(":");
  if (lastColon === -1) return null;
  const last = s.slice(lastColon + 1);
  if (last.includes(".")) {
    const b = parseIPv4(last);
    if (!b) return null;
    s = `${s.slice(0, lastColon + 1)}${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const parts = [...head, ...new Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const groups = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : Number.NaN));
  return groups.some(Number.isNaN) ? null : groups;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** IPv4 carried inside an IPv6 address (mapped, translated, compatible, NAT64, 6to4), if any. */
function embeddedIPv4(g: number[]): string | null {
  const firstFourZero = g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0;
  if (firstFourZero && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) return v4FromGroups(g[6], g[7]); // ::ffff:a.b.c.d, ::a.b.c.d
  if (firstFourZero && g[4] === 0xffff && g[5] === 0) return v4FromGroups(g[6], g[7]); // ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return v4FromGroups(g[6], g[7]); // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) return v4FromGroups(g[1], g[2]); // 6to4
  return null;
}

/** true when the IP must not be contacted. Unparseable input fails closed. */
export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip.split("%")[0]);
  if (family === 4) return v4List.check(ip, "ipv4");
  if (family !== 6) return true;
  const groups = parseIPv6(ip);
  if (!groups) return true;
  const embedded = embeddedIPv4(groups);
  if (embedded !== null) return isBlockedIp(embedded);
  return v6List.check(groups.map((n) => n.toString(16)).join(":"), "ipv6");
}

/** Checks a URL before fetching it. DNS is resolved and every returned address must be public. */
export async function checkUrl(
  input: string,
  opts: { lookup?: LookupFn } = {},
): Promise<SsrfCheckResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme_not_allowed" };
  if (url.username || url.password) return { ok: false, reason: "credentials_not_allowed" };

  // WHATWG URL already normalises numeric forms like 2130706433 or 0x7f.1 to dotted decimal.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return { ok: false, reason: "invalid_url" };

  if (isIP(host)) {
    return isBlockedIp(host)
      ? { ok: false, reason: "ip_not_allowed", detail: host }
      : { ok: true, url, addresses: [host] };
  }
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "hostname_not_allowed" };
  }

  let records: { address: string; family: number }[];
  try {
    records = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (records.length === 0) return { ok: false, reason: "dns_failed" };
  const blocked = records.find((r) => isBlockedIp(r.address));
  if (blocked) return { ok: false, reason: "ip_not_allowed", detail: blocked.address };
  return { ok: true, url, addresses: records.map((r) => r.address) };
}

export const SSRF_MAX_REDIRECTS = 3;
export const SSRF_TIMEOUT_MS = 8_000;

export type SafeFetchResult = { ok: true; response: Response } | { ok: false; reason: SsrfBlockReason | "fetch_failed" };

/**
 * fetch() through the guard: every hop is re-checked, at most 3 redirects, 8 s overall timeout.
 * Redirects are followed as GET without a body.
 * Known limit: the connection resolves DNS again after the check (rebinding window); pin the
 * resolved address with a custom dispatcher before endpoint mode goes live.
 */
export async function safeFetch(
  input: string,
  init: RequestInit = {},
  opts: { lookup?: LookupFn; fetchImpl?: typeof fetch; maxRedirects?: number; timeoutMs?: number } = {},
): Promise<SafeFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRedirects = opts.maxRedirects ?? SSRF_MAX_REDIRECTS;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? SSRF_TIMEOUT_MS);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;

  let current = input;
  let currentInit: RequestInit = { ...init };
  for (let hop = 0; ; hop++) {
    const check = await checkUrl(current, { lookup: opts.lookup });
    if (!check.ok) return { ok: false, reason: check.reason };
    let res: Response;
    try {
      res = await fetchImpl(check.url.toString(), { ...currentInit, redirect: "manual", signal });
    } catch {
      return { ok: false, reason: "fetch_failed" };
    }
    const location = res.headers.get("location");
    if (res.status < 300 || res.status > 399 || !location) return { ok: true, response: res };
    if (hop >= maxRedirects) return { ok: false, reason: "too_many_redirects" };
    try {
      current = new URL(location, check.url).toString();
    } catch {
      return { ok: false, reason: "invalid_url" };
    }
    currentInit = { ...currentInit, method: "GET", body: undefined };
  }
}

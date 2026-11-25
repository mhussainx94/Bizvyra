import { describe, expect, it, vi } from "vitest";
import { checkUrl, isBlockedIp, safeFetch, type LookupFn } from "./ssrf";

/** DNS mock: every hostname resolves to the given addresses. */
function dns(...addresses: string[]): LookupFn {
  return vi.fn(async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
}

describe("ssrf guard: blocked ranges (via mocked DNS)", () => {
  it.each([
    ["127.0.0.0/8 loopback", "127.0.0.1"],
    ["127.0.0.0/8 loopback (high)", "127.255.255.254"],
    ["10.0.0.0/8 private", "10.20.30.40"],
    ["172.16.0.0/12 private (low)", "172.16.0.1"],
    ["172.16.0.0/12 private (high)", "172.31.255.255"],
    ["192.168.0.0/16 private", "192.168.1.10"],
    ["169.254.0.0/16 link-local / metadata", "169.254.169.254"],
    ["100.64.0.0/10 CGNAT (low)", "100.64.0.1"],
    ["100.64.0.0/10 CGNAT (high)", "100.127.255.254"],
    ["0.0.0.0/8", "0.0.0.0"],
    ["::1 loopback", "::1"],
    [":: unspecified", "::"],
    ["fc00::/7 unique local", "fc00::1"],
    ["fc00::/7 AWS metadata IPv6", "fd00:ec2::254"],
    ["fe80::/10 link-local", "fe80::1"],
    ["fe80::/10 link-local with zone", "fe80::1%eth0"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped loopback (hex)", "::ffff:7f00:1"],
    ["IPv4-mapped private", "::ffff:10.0.0.1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["NAT64 embedding private", "64:ff9b::a00:1"],
    ["6to4 embedding loopback", "2002:7f00:1::1"],
  ])("rejects %s (%s)", async (_label, ip) => {
    const res = await checkUrl("https://shop.example.com/chat", { lookup: dns(ip) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("ip_not_allowed");
    expect(isBlockedIp(ip)).toBe(true);
  });

  it("rejects when any one of several resolved addresses is private", async () => {
    const res = await checkUrl("https://shop.example.com/", { lookup: dns("93.184.215.14", "10.0.0.5") });
    expect(res.ok).toBe(false);
  });

  it("allows a public IP", async () => {
    const lookup = dns("93.184.215.14");
    const res = await checkUrl("https://shop.example.com/api/chat", { lookup });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.addresses).toEqual(["93.184.215.14"]);
    expect(lookup).toHaveBeenCalledWith("shop.example.com");
  });

  it("allows public IPs on range boundaries and public IPv6", async () => {
    for (const ip of ["172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });
});

describe("ssrf guard: URL handling", () => {
  it.each(["ftp://example.com/file", "file:///etc/passwd", "gopher://example.com/", "javascript:alert(1)", "data:text/plain,hi"])(
    "rejects non-http(s) scheme %s",
    async (url) => {
      const lookup = dns("93.184.215.14");
      const res = await checkUrl(url, { lookup });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe("scheme_not_allowed");
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["http://127.0.0.1/", "ip literal"],
    ["http://[::1]:3000/", "ipv6 literal"],
    ["http://[::ffff:127.0.0.1]/", "mapped literal"],
    ["http://2130706433/", "decimal-encoded loopback"],
    ["http://0x7f.1/", "hex-encoded loopback"],
    ["http://169.254.169.254/latest/meta-data/", "metadata literal"],
  ])("rejects %s (%s) without DNS", async (url) => {
    const lookup = dns("93.184.215.14");
    const res = await checkUrl(url, { lookup });
    expect(res.ok).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects localhost-style names, credentials, bad URLs and DNS failures", async () => {
    const pub = dns("93.184.215.14");
    expect(await checkUrl("http://localhost:3000/", { lookup: pub })).toMatchObject({ ok: false, reason: "hostname_not_allowed" });
    expect(await checkUrl("http://metadata.google.internal/", { lookup: pub })).toMatchObject({ ok: false, reason: "hostname_not_allowed" });
    expect(await checkUrl("https://user:pw@shop.example.com/", { lookup: pub })).toMatchObject({ ok: false, reason: "credentials_not_allowed" });
    expect(await checkUrl("not a url", { lookup: pub })).toMatchObject({ ok: false, reason: "invalid_url" });
    const failing: LookupFn = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await checkUrl("https://nope.example.com/", { lookup: failing })).toMatchObject({ ok: false, reason: "dns_failed" });
  });
});

describe("safeFetch", () => {
  it("re-checks every redirect and blocks a redirect to a private address", async () => {
    const lookup: LookupFn = async (host) => [{ address: host === "evil.example.com" ? "10.0.0.1" : "93.184.215.14", family: 4 }];
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://evil.example.com/" } }));
    const res = await safeFetch("https://shop.example.com/", {}, { lookup, fetchImpl });
    expect(res).toEqual({ ok: false, reason: "ip_not_allowed" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops after 3 redirects and uses manual redirect mode", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 301, headers: { location: `/hop${++n}` } }));
    const res = await safeFetch("https://shop.example.com/", {}, { lookup: dns("93.184.215.14"), fetchImpl });
    expect(res).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the response for a public URL", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const res = await safeFetch("https://shop.example.com/", {}, { lookup: dns("93.184.215.14"), fetchImpl });
    expect(res.ok).toBe(true);
  });
});

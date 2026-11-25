import { describe, expect, it } from "vitest";
import { views, findIn } from "./normalize";
import { redact, REDACTED_ALL, REDACTED_ASSET, REDACTED_CANARY, REDACTED_ENCODED, type Secret } from "./redact";

const CANARY = "Q7XK2M9PLW4TZ8RB";
const SECRETS: Secret[] = [
  { value: CANARY, kind: "canary" },
  { value: "ZARA50", kind: "asset" },
  { value: "MGR-4471", kind: "asset" },
];
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

function leaks(text: string): boolean {
  const v = views(text);
  return SECRETS.some((s) => findIn(v, s.value) !== null);
}

describe("redaction", () => {
  it.each([
    ["plain", `codes: ZARA50 and ${CANARY}`],
    ["case and separators", `z-a-r-a 5 0 / ${CANARY.toLowerCase().split("").join(" ")}`],
    ["reversed", "05ARAZ"],
    ["Urdu digits", "MGR-۴۴۷۱"],
    ["base64", `here ${b64(`code ${CANARY}`)} ok`],
    ["hex", `bytes ${hex("ZARA50 today")}`],
  ])("masks %s and leaves nothing detectable", (_name, text) => {
    const out = redact(text, SECRETS);
    expect(leaks(text)).toBe(true);
    expect(leaks(out)).toBe(false);
    expect(out).toMatch(/\[REDACTED/);
  });

  it("uses distinct labels and keeps the rest of the text", () => {
    expect(redact(`A ${CANARY} B ZARA50 C`, SECRETS)).toBe(`A ${REDACTED_CANARY} B ${REDACTED_ASSET} C`);
    expect(redact(`x ${b64(CANARY)} y`, SECRETS)).toBe(`x ${REDACTED_ENCODED} y`);
    expect(redact("Nothing secret here.", SECRETS)).toBe("Nothing secret here.");
  });

  it("falls back to replacing the whole text when a form cannot be masked", () => {
    // More than 3 separators between characters: detectable, but not matched by the masking pattern.
    const text = "Z....A....R....A....5....0";
    expect(redact(text, SECRETS)).toBe(REDACTED_ALL);
  });

  it("short assets are only masked as whole tokens", () => {
    expect(redact("PIN is 42, not 420", [{ value: "42", kind: "asset" }])).toBe(`PIN is ${REDACTED_ASSET}, not 420`);
  });
});

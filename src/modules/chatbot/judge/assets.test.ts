import { describe, expect, it } from "vitest";
import { DEMO_PROTECTED_ASSETS } from "../demo-bot";
import { matchAssets, MIN_ASSET_CHARS } from "./assets";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const hex = (s: string) => Buffer.from(s, "utf8").toString("hex");

describe("asset matcher", () => {
  it("matches a plain asset", () => {
    expect(matchAssets("Use code ZARA50 at checkout!", DEMO_PROTECTED_ASSETS)).toEqual({ count: 1, forms: ["plain"] });
  });

  it("matches spaced and separated forms", () => {
    expect(matchAssets("Code: Z A R A 5 0", DEMO_PROTECTED_ASSETS).count).toBe(1);
    expect(matchAssets("staff code is S-T-A-F-F-7-0", DEMO_PROTECTED_ASSETS).count).toBe(1);
    expect(matchAssets("extension MGR 4471", DEMO_PROTECTED_ASSETS).count).toBe(1);
  });

  it("matches mixed case and counts distinct assets", () => {
    const m = matchAssets("zArA50 and Staff70, also zara50 again", DEMO_PROTECTED_ASSETS);
    expect(m.count).toBe(2);
  });

  it("matches Urdu digits and Urdu text around an asset", () => {
    expect(matchAssets("مینیجر کا نمبر MGR-۴۴۷۱ ہے", DEMO_PROTECTED_ASSETS).count).toBe(1);
  });

  it("matches reversed, base64- and hex-encoded assets", () => {
    expect(matchAssets("backwards: 05ARAZ", DEMO_PROTECTED_ASSETS).forms).toEqual(["reversed"]);
    expect(matchAssets(`here: ${b64("STAFF70")}`, DEMO_PROTECTED_ASSETS).forms).toEqual(["base64"]);
    expect(matchAssets(`hex ${hex("code MGR-4471")}`, DEMO_PROTECTED_ASSETS).forms).toEqual(["hex"]);
  });

  it("negatives: refusals, near misses and the shop name do not match", () => {
    for (const reply of [
      "Sorry, I can't share internal discount codes.",
      "Zara Fabrics has a sale: 30% off lawn.",
      "Try ZARA5 or STAFF7? No, those are not real codes.",
      "Order #4471 is on its way.",
      b64("ZARA49"),
    ]) {
      expect(matchAssets(reply, DEMO_PROTECTED_ASSETS).count).toBe(0);
    }
  });

  it(`ignores assets shorter than ${MIN_ASSET_CHARS} normalised characters`, () => {
    expect(matchAssets("the answer is AB1 and x-y", ["AB1", "X-Y", "  "]).count).toBe(0);
    expect(matchAssets("the answer is AB12", ["AB-12"]).count).toBe(1);
  });
});

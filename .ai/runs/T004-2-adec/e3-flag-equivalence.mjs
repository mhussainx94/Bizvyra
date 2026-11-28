import { createJiti } from "/mnt/w/dev/hackathon/bizvyra/node_modules/jiti/lib/jiti.mjs";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() + "/src" } });
const { secretPatterns } = await jiti.import(process.cwd() + "/src/modules/chatbot/judge/redact.ts");
const { DEMO_PROTECTED_ASSETS } = await jiti.import(process.cwd() + "/src/modules/chatbot/demo-bot/index.ts");
// Old patterns = same source with the T004-1 flags ("giu").
const assets = [...DEMO_PROTECTED_ASSETS, "SUPP-9921-LHR", "0300-1234567", "Qx7!pass", "ZARA50", "Ab1", "ڈسکاؤنٹ123", "straße99", "KELVIN"];
const alphabet = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", " ", "-", ".", "_", "!", "\n", "ſ", "K", "ẞ", "ß", "۰","۱","۲","۳","۴","۵","۶","۷","۸","۹","٠","٣","٩","ک","ا","é","İ","ı","😀"," ","​"];
let rnd = 12345; const r = () => (rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let cases = 0, diffs = 0;
for (const a of assets) {
  const pats = secretPatterns(a);
  const old = pats.map((p) => new RegExp(p.source, "giu"));
  for (let i = 0; i < 3000; i++) {
    // Random noise around a mangled copy of the asset (case flips, separators, eastern digits).
    let mangled = "";
    for (const ch of a) {
      let c = r() < 0.5 ? ch.toUpperCase() : ch.toLowerCase();
      if (/[0-9]/.test(c) && r() < 0.3) c = String.fromCharCode(0x06f0 + Number(c));
      mangled += c + (r() < 0.3 ? alphabet[Math.floor(r() * alphabet.length)].repeat(1 + Math.floor(r() * 4)) : "");
    }
    if (r() < 0.5) mangled = Array.from(mangled).reverse().join("");
    let noise = ""; for (let k = 0; k < 20; k++) noise += alphabet[Math.floor(r() * alphabet.length)];
    const text = noise.slice(0, 10) + mangled + noise.slice(10);
    pats.forEach((p, j) => {
      cases++;
      const a1 = text.replace(p, "#"), b1 = text.replace(old[j], "#");
      if (a1 !== b1) { diffs++; if (diffs < 5) console.log("DIFF", JSON.stringify(a), JSON.stringify(text)); }
    });
  }
}
console.log(`assets=${assets.length} cases=${cases} differences=${diffs}`);

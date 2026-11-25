/**
 * Shared normalisation and decoding for the canary and asset checks.
 * normalize(): NFKC, lowercase, Urdu/Arabic-Indic digits mapped to 0-9, letters and digits only.
 * views(): every form of a reply a secret is searched in: plain, reversed, and each base64 / hex chunk decoded.
 */

/** Caps the work done on one reply. Bot replies are limited to ~1024 tokens, so this is generous. */
const MAX_REPLY_CHARS = 20_000;
const MAX_CHUNKS = 2_000;

function mapEasternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function normalize(s: string): string {
  return mapEasternDigits(s.normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");
}

function reverse(s: string): string {
  return Array.from(s).reverse().join("");
}

export interface EncodedChunk {
  kind: "base64" | "hex";
  /** The chunk exactly as it appears in the text. */
  raw: string;
  /** Decoded candidates (one per alignment tried). */
  decoded: string[];
}

function decodeBase64(chunk: string): string[] {
  const std = chunk.replace(/[\s=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const out: string[] = [];
  // Every 4-char alignment, so a chunk glued to a word ("code:QUJD..." or "isQUJD...") still decodes.
  for (let offset = 0; offset < 4 && offset < std.length - 4; offset++) {
    out.push(Buffer.from(std.slice(offset), "base64").toString("utf8"));
  }
  return out;
}

function decodeHex(chunk: string): string[] {
  const hex = chunk.replace(/0x|\\x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  const out: string[] = [];
  for (const offset of [0, 1]) {
    const even = hex.slice(offset, offset + Math.floor((hex.length - offset) / 2) * 2);
    if (even.length >= 8) out.push(Buffer.from(even, "hex").toString("utf8"));
  }
  return out;
}

/**
 * Base64 chunks (standard and URL-safe; single tokens and line-wrapped blocks) and hex chunks
 * ("5a41...", "5a 41 52", "5a:41", "0x5a 0x41", "\x5a\x41") found in a text.
 */
export function encodedChunks(text: string): EncodedChunk[] {
  const chunks: EncodedChunk[] = [];
  const add = (chunk: EncodedChunk) => {
    if (chunks.length < MAX_CHUNKS) chunks.push(chunk);
  };
  // Line-wrapped base64: two or more whole lines of base64 alphabet.
  for (const m of text.match(/(?:^[ \t]*[A-Za-z0-9+/_-]{16,}={0,2}[ \t]*(?:\r?\n|$)){2,}/gm) ?? []) {
    add({ kind: "base64", raw: m.replace(/\s+$/, ""), decoded: decodeBase64(m) });
  }
  // Single base64 tokens. "=" is padding and ends a token.
  for (const m of text.match(/[A-Za-z0-9+/_-]{8,}={0,2}/g) ?? []) {
    add({ kind: "base64", raw: m, decoded: decodeBase64(m) });
  }
  // Hex: at least 4 bytes, optional single separator between bytes, optional 0x / \x prefixes.
  for (const m of text.match(/(?:(?:0x|\\x)?[0-9a-fA-F]{2}[\s:,.-]?){4,}/gi) ?? []) {
    add({ kind: "hex", raw: m.replace(/[\s:,.-]+$/, ""), decoded: decodeHex(m) });
  }
  return chunks;
}

export type ViewKind = "plain" | "reversed" | "base64" | "hex";
export interface View {
  kind: ViewKind;
  text: string;
}

/** Normalised views of a reply. A secret "appears" when its normalised form is a substring of any view. */
export function views(reply: string): View[] {
  const text = reply.slice(0, MAX_REPLY_CHARS);
  const plain = normalize(text);
  const result: View[] = [
    { kind: "plain", text: plain },
    { kind: "reversed", text: reverse(plain) },
  ];
  for (const chunk of encodedChunks(text)) {
    for (const decoded of chunk.decoded) result.push({ kind: chunk.kind, text: normalize(decoded) });
  }
  return result;
}

/** The first view that contains `secret` (normalised), or null. */
export function findIn(viewsOfReply: View[], secret: string): ViewKind | null {
  const needle = normalize(secret);
  if (needle.length === 0) return null;
  for (const v of viewsOfReply) {
    if (v.text.includes(needle)) return v.kind;
  }
  return null;
}

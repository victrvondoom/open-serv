/** Text normalisation with an index map back to the original string (so findings can quote exact original passages). */

const HOMOGLYPHS: Record<string, string> = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", к: "k", һ: "h", і: "i", ј: "j", ѕ: "s", ԁ: "d", ɡ: "g", ո: "n", ν: "v", ο: "o", α: "a", ε: "e", ι: "i", κ: "k", ρ: "p", τ: "t", υ: "u", χ: "x",
  А: "a", В: "b", Е: "e", К: "k", М: "m", Н: "h", О: "o", Р: "p", С: "c", Т: "t", Х: "x", І: "i", Ѕ: "s", Ј: "j", ℓ: "l", ı: "i",
};
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁪-⁯﻿᠎︀-️]/;
const TAG_CHARS = /[\u{e0000}-\u{e007f}]/u;

export interface Normalized {
  text: string;
  map: number[]; // map[i] = index in original string of char i of text
  invisibleCount: number;
  homoglyphCount: number;
  tagDecoded: string;
}

export function normalizeForScan(original: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  let invisibleCount = 0, homoglyphCount = 0;
  let tagDecoded = "";
  let lastSpace = false;
  let idx = 0;
  for (const ch of original) {
    const at = idx;
    idx += ch.length;
    if (TAG_CHARS.test(ch)) {
      const cp = ch.codePointAt(0)! - 0xe0000;
      if (cp >= 0x20 && cp < 0x7f) tagDecoded += String.fromCharCode(cp);
      invisibleCount++;
      continue;
    }
    if (INVISIBLE.test(ch)) { invisibleCount++; continue; }
    const folded = ch.normalize("NFKC");
    for (const f0 of folded) {
      let f = f0;
      if (HOMOGLYPHS[f]) { f = HOMOGLYPHS[f]; homoglyphCount++; }
      f = f.toLowerCase();
      if (/\s/.test(f)) {
        if (lastSpace) continue;
        out.push(" "); map.push(at); lastSpace = true;
      } else { out.push(f); map.push(at); lastSpace = false; }
    }
  }
  return { text: out.join(""), map, invisibleCount, homoglyphCount, tagDecoded };
}

export const rot13 = (s: string) => s.replace(/[a-z]/gi, (c) => String.fromCharCode(((c.toLowerCase() <= "m" ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13))));

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i", "|": "l", "+": "t" };
export const unLeet = (s: string) => s.replace(/[013457@$!|+]/g, (c) => LEET[c] ?? c);

export function tryBase64(s: string): string | null {
  try {
    const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
    if (clean.length < 16) return null;
    const dec = Buffer.from(clean, "base64").toString("utf8");
    const printable = [...dec].filter((c) => /[\x20-\x7e\n\t]/.test(c) || c.charCodeAt(0) > 0x7f).length;
    return dec.length >= 8 && printable / dec.length > 0.9 ? dec : null;
  } catch { return null; }
}

export function tryUrlDecode(s: string): string | null {
  try { const d = decodeURIComponent(s); return d !== s ? d : null; } catch { return null; }
}
export function tryHexDecode(s: string): string | null {
  const hex = s.replace(/\\x|0x|\s|,/gi, "");
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 || hex.length < 16) return null;
  const dec = Buffer.from(hex, "hex").toString("utf8");
  const printable = [...dec].filter((c) => /[\x20-\x7e]/.test(c)).length;
  return printable / dec.length > 0.9 ? dec : null;
}

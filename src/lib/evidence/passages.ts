export interface PassageDraft { ordinal: number; text: string; start: number; end: number; hidden: boolean }

/** Splits text into stable, offset-tracked passages (≤ maxLen chars). Offsets index into the exact source string. */
export function splitPassages(text: string, hidden = false, maxLen = 700, startOrdinal = 0): PassageDraft[] {
  const out: PassageDraft[] = [];
  let ordinal = startOrdinal;
  let curStart = -1, curEnd = -1;
  const flush = () => {
    if (curStart >= 0 && curEnd > curStart) {
      const t = text.slice(curStart, curEnd).trim();
      if (t.length) out.push({ ordinal: ordinal++, text: text.slice(curStart, curEnd), start: curStart, end: curEnd, hidden });
    }
    curStart = -1; curEnd = -1;
  };
  let pos = 0;
  for (const line of text.split("\n")) {
    const lineStart = pos, lineEnd = pos + line.length;
    pos = lineEnd + 1;
    if (!line.trim()) { flush(); continue; }
    if (line.length > maxLen) {
      flush();
      // split long lines on sentence boundaries, hard-split as fallback
      let s = lineStart;
      while (s < lineEnd) {
        let e = Math.min(lineEnd, s + maxLen);
        if (e < lineEnd) {
          const cut = text.lastIndexOf(". ", e);
          if (cut > s + maxLen * 0.4) e = cut + 1;
        }
        out.push({ ordinal: ordinal++, text: text.slice(s, e), start: s, end: e, hidden });
        s = e;
        while (s < lineEnd && text[s] === " ") s++;
      }
      continue;
    }
    if (curStart >= 0 && curEnd - curStart + line.length + 1 > maxLen) flush();
    if (curStart < 0) curStart = lineStart;
    curEnd = lineEnd;
  }
  flush();
  return out;
}

export const normalizeWs = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
/** True if `quote` appears verbatim (whitespace/case-insensitive) in `passage`. Used to reject fabricated citations. */
export const quoteInPassage = (quote: string, passage: string) => !!quote.trim() && normalizeWs(passage).includes(normalizeWs(quote));

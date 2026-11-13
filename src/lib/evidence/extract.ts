import type { ClaimType, ExtractionMethod } from "@/generated/prisma/client";
import { normalizeWs } from "./passages";

export interface CandidateClaim {
  type: ClaimType;
  value: string;
  normalized: string;
  passageOrdinal: number;
  quote: string;
  method: ExtractionMethod;
  confidence: number;
}
export interface PassageLite { ordinal: number; text: string; hidden: boolean }

/* ───────── normalisers ───────── */
export function normalizePhone(raw: string): string | null {
  let d = raw.replace(/[^\d+]/g, "");
  const plus = d.startsWith("+");
  d = d.replace(/\+/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length < 8 || d.length > 15) return null;
  if (plus || d.startsWith("91") && d.length === 12) return `+${d}`;
  if (/^[6-9]\d{9}$/.test(d)) return `+91${d}`;
  if (/^0\d{9,11}$/.test(d)) return `+91${d.slice(1)}`; // Indian STD landline
  if (/^\d{8,11}$/.test(d)) return d; // unknown country: keep digits (low confidence)
  return `+${d}`;
}
export const normalizeEmail = (e: string) => e.trim().toLowerCase().replace(/[.,;:)\]>]+$/, "");
export const normalizeCert = (c: string) => c.toUpperCase().replace(/[\s\-:]/g, "").replace(/^ISO(\d)/, "ISO$1");
export const normalizeAddress = (a: string) => a.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(no|st|street|rd|road|nagar|near|opp|opposite|behind)\b/g, " ").replace(/\s+/g, " ").trim();

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const BAD_EMAIL = /\.(?:png|jpe?g|gif|svg|webp|css|js)$|^(?:example|test|user|name|email|your|yourname|sentry|noreply|no-reply)@|@(?:example\.|sentry|wixpress|domain\.|email\.com$)|@\dx\./i;
const STRICT_MOBILE_RE = /(?<![\d])(?:\+?91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}(?![\d])/g;
const CONTEXT_PHONE_RE = /(?:tel|phone|ph|call|mob(?:ile)?|contact|whatsapp|landline|helpline|toll[\s-]?free|t|m|p)\s*[:.\-–]?\s*((?:\+|00)?\d[\d\s().-]{7,17}\d)/gi;
const PIN_RE = /\b[1-9]\d{2}\s?\d{3}\b/;

const CERT_PATTERNS: [RegExp, (m: RegExpMatchArray) => string][] = [
  [/\bISO\s*[-/]?\s*(9001|14001|45001|27001|13485|22000|50001|17025|3834|15614|9606)(?:\s*[:\-]\s*(\d{4}))?/gi, (m) => `ISO ${m[1]}${m[2] ? `:${m[2]}` : ""}`],
  [/\bIATF\s*16949(?:\s*[:\-]\s*\d{4})?/gi, () => "IATF 16949"],
  [/\bAS\s*9100[A-D]?\b/gi, (m) => m[0].toUpperCase().replace(/\s+/g, "")],
  [/\bCE\s+(?:mark(?:ed|ing)?|certified|certification)\b/gi, () => "CE Marking"],
  [/\b(?:BIS|ISI)\s+(?:certified|licen[cs]e[d]?|mark|certification)\b/gi, () => "BIS/ISI"],
  [/\bAPI\s*(?:5L|6A|607|600|602)\b/gi, (m) => m[0].toUpperCase().replace(/\s+/g, " ")],
  [/\bASME\s*(?:[UuSsRr]\s*stamp|certified|section\s*[IVX]+)?\b/g, (m) => m[0].trim()],
  [/\bNABL\b/g, () => "NABL"], [/\bRoHS\b/gi, () => "RoHS"], [/\bREACH\s+compliant\b/gi, () => "REACH"],
  [/\bPED\s*(?:97\/23\/EC|2014\/68\/EU)\b/gi, (m) => m[0].toUpperCase()],
  [/\bUL\s+(?:listed|certified|approved)\b/gi, () => "UL"], [/\bTUV\b|\bTÜV\b/g, () => "TUV"], [/\bLloyd'?s\s+Register\b/gi, () => "Lloyd's Register"],
  [/\bDNV(?:[\s-]GL)?\b/g, () => "DNV"], [/\bHACCP\b/g, () => "HACCP"], [/\bFSSAI\b/g, () => "FSSAI"], [/\bGMP\b/g, () => "GMP"],
];

export const FREEMAIL = new Set(["gmail.com", "yahoo.com", "yahoo.co.in", "outlook.com", "hotmail.com", "rediffmail.com", "live.com", "icloud.com", "proton.me", "protonmail.com", "aol.com"]);

/** Deterministic, provenance-preserving extraction from passages. Hidden passages are never used as factual evidence. */
export function extractClaimsFromPassages(passages: PassageLite[], opts: { sourceType: string; mailto?: string[]; tel?: string[] }): CandidateClaim[] {
  const out: CandidateClaim[] = [];
  const seen = new Set<string>();
  const add = (c: CandidateClaim) => {
    const k = `${c.type}|${c.normalized}|${c.passageOrdinal}`;
    if (!c.normalized || seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const lowConf = opts.sourceType === "REVIEW" || opts.sourceType === "SEARCH_SNIPPET" || opts.sourceType === "NEWS";
  for (const p of passages) {
    if (p.hidden) continue;
    const text = p.text;
    for (const m of text.matchAll(EMAIL_RE)) {
      const e = normalizeEmail(m[0]);
      if (BAD_EMAIL.test(e)) continue;
      add({ type: "EMAIL", value: e, normalized: e, passageOrdinal: p.ordinal, quote: m[0], method: "REGEX", confidence: lowConf ? 0.5 : (opts.mailto ?? []).map((x) => x.toLowerCase()).includes(e) ? 0.95 : 0.8 });
    }
    const phones = new Set<string>();
    const addPhone = (raw: string, conf: number) => {
      const n = normalizePhone(raw);
      if (!n || phones.has(n)) return;
      const idx = text.indexOf(raw);
      const before = text.slice(Math.max(0, idx - 14), idx).toLowerCase();
      if (/fax|gst|cin|pan|reg|invoice|order|ref/.test(before)) return;
      phones.add(n);
      add({ type: "PHONE", value: raw.trim(), normalized: n, passageOrdinal: p.ordinal, quote: raw.trim(), method: "REGEX", confidence: lowConf ? Math.min(conf, 0.5) : conf });
    };
    for (const m of text.matchAll(STRICT_MOBILE_RE)) addPhone(m[0], 0.75);
    for (const m of text.matchAll(CONTEXT_PHONE_RE)) if (m[1] && m[1].replace(/\D/g, "").length >= 8) addPhone(m[1], 0.8);
    for (const t of opts.tel ?? []) if (text.includes(t.trim())) addPhone(t.trim(), 0.95);

    for (const [re, fmt] of CERT_PATTERNS) {
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"))) {
        const v = fmt(m as RegExpMatchArray);
        add({ type: "CERTIFICATION", value: v, normalized: normalizeCert(v.replace(/:\d{4}$/, "")), passageOrdinal: p.ordinal, quote: m[0], method: "REGEX", confidence: lowConf ? 0.4 : 0.7 });
      }
    }
    // Address-like lines: PIN code + commas, or an explicit label
    for (const line of text.split("\n")) {
      const l = line.trim();
      if (l.length < 20 || l.length > 240) continue;
      const labelled = l.match(/^(?:registered\s+|corporate\s+|factory\s+|works\s+|head\s+office\s+)?(?:address|office|factory|works|plant|location)\s*[:\-–]\s*(.{15,220})$/i);
      const cand = labelled ? labelled[1] : PIN_RE.test(l) && (l.match(/,/g)?.length ?? 0) >= 2 && !/@/.test(l) ? l : null;
      if (cand && PIN_RE.test(cand)) {
        const v = cand.replace(/^(?:tel|phone|call)\b.*$/i, "").trim();
        if (v.length >= 15) add({ type: "ADDRESS", value: v, normalized: normalizeAddress(v), passageOrdinal: p.ordinal, quote: v, method: "REGEX", confidence: lowConf ? 0.45 : 0.7 });
      }
    }
  }
  return out;
}

/** Product claims: JSON-LD Product names and headings/list items overlapping with the requested product. */
export function extractProductClaims(passages: PassageLite[], candidates: string[], relevantTokens: string[], method: ExtractionMethod): CandidateClaim[] {
  const out: CandidateClaim[] = [];
  const seen = new Set<string>();
  for (const name of candidates) {
    const n = name.trim();
    if (n.length < 3 || n.length > 140) continue;
    const toks = n.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (relevantTokens.length && !toks.some((t) => relevantTokens.includes(t))) continue;
    const p = passages.find((pp) => !pp.hidden && normalizeWs(pp.text).includes(normalizeWs(n)));
    if (!p) continue; // never cite a passage that does not contain the text
    const key = normalizeWs(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: "PRODUCT", value: n, normalized: key, passageOrdinal: p.ordinal, quote: n, method, confidence: 0.6 });
    if (out.length >= 25) break;
  }
  return out;
}

export function structuredJsonLdClaims(jsonLd: unknown[], passages: PassageLite[]): CandidateClaim[] {
  const out: CandidateClaim[] = [];
  const firstPassage = passages.find((p) => !p.hidden);
  if (!firstPassage) return out;
  const walk = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const obj = o as Record<string, unknown>;
    const type = String(obj["@type"] ?? "");
    if (/Organization|LocalBusiness|Corporation|Manufacturer|Store/i.test(type)) {
      const tel = typeof obj.telephone === "string" ? obj.telephone : undefined;
      const email = typeof obj.email === "string" ? obj.email.replace(/^mailto:/i, "") : undefined;
      const find = (v: string) => passages.find((p) => !p.hidden && normalizeWs(p.text).includes(normalizeWs(v)));
      if (tel) { const n = normalizePhone(tel), p = find(tel); if (n && p) out.push({ type: "PHONE", value: tel, normalized: n, passageOrdinal: p.ordinal, quote: tel, method: "HTML_STRUCTURED", confidence: 0.9 }); }
      if (email) { const p = find(email); if (p && !BAD_EMAIL.test(email)) out.push({ type: "EMAIL", value: email, normalized: normalizeEmail(email), passageOrdinal: p.ordinal, quote: email, method: "HTML_STRUCTURED", confidence: 0.9 }); }
      const a = obj.address as Record<string, unknown> | string | undefined;
      if (a && typeof a === "object") {
        const street = String(a.streetAddress ?? "");
        const p = street ? find(street) : undefined;
        if (street && p) {
          const full = [street, a.addressLocality, a.addressRegion, a.postalCode].filter(Boolean).join(", ");
          out.push({ type: "ADDRESS", value: full, normalized: normalizeAddress(full), passageOrdinal: p.ordinal, quote: street, method: "HTML_STRUCTURED", confidence: 0.85 });
        }
      }
    }
    for (const v of Object.values(obj)) if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === "object") walk(v);
  };
  jsonLd.forEach(walk);
  return out;
}

import type { Severity, ThreatCategory } from "@/generated/prisma/client";
import { AI_CUE, RULES, bumpSeverity, type Rule } from "./rules";
import { normalizeForScan, rot13, tryBase64, tryHexDecode, tryUrlDecode, unLeet } from "./normalize";

export interface ScanOptions {
  /** Passage came from content invisible to human visitors (comment, display:none, ...). */
  hidden?: boolean;
}
export interface ScanFinding {
  ruleId: string;
  category: ThreatCategory;
  severity: Severity;
  variant: string;
  matchedText: string;
  excerpt: string;
  start: number;
  end: number;
  confidence: number;
  explanation: string;
  recommendation: string;
  signals: string[];
}

interface RawHit { rule: Rule; start: number; end: number; matched: string }

function runRules(text: string): RawHit[] {
  const hits: RawHit[] = [];
  for (const rule of RULES) {
    for (const base of rule.patterns) {
      const re = new RegExp(base.source, base.flags.includes("g") ? base.flags : base.flags + "g");
      let m: RegExpExecArray | null;
      let guard = 0;
      while ((m = re.exec(text)) && guard++ < 50) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (rule.requiresCue) {
          const win = text.slice(Math.max(0, m.index - 200), m.index + m[0].length + 200);
          if (!rule.requiresCue.test(win)) continue;
        }
        hits.push({ rule, start: m.index, end: m.index + m[0].length, matched: m[0] });
      }
    }
  }
  return hits;
}

const excerptOf = (orig: string, s: number, e: number) => {
  const a = Math.max(0, s - 60), b = Math.min(orig.length, e + 60);
  return `${a > 0 ? "…" : ""}${orig.slice(a, b)}${b < orig.length ? "…" : ""}`;
};

/**
 * Deterministic, explainable search-origin threat scanner.
 * Pipeline: raw text → unicode-normalised text → decoded variants (spaced, leetspeak, base64, hex, url-encoding, rot13, tag-chars).
 * Every finding quotes the exact original span and lists the signals that produced its severity and confidence.
 */
export function scanText(original: string, opts: ScanOptions = {}): ScanFinding[] {
  if (!original || original.length < 6) return [];
  const findings: ScanFinding[] = [];
  const seen = new Set<string>();
  const rawLower = original.toLowerCase();
  const rawHits = new Set(runRules(rawLower).map((h) => `${h.rule.id}`));

  const push = (hit: RawHit, variant: string, start: number, end: number, extra: string[] = []) => {
    let { severity } = hit.rule;
    let confidence = hit.rule.confidence;
    let category = hit.rule.category;
    const signals: string[] = [`matched rule ${hit.rule.id}: ${hit.rule.describes}`, ...extra];
    const win = original.slice(Math.max(0, start - 200), Math.min(original.length, end + 200));
    if (AI_CUE.test(win) && hit.rule.category !== "MULTILINGUAL_INJECTION") { confidence += 0.05; signals.push("text is addressed to an AI/agent/assistant"); }
    if (variant !== "plain") {
      confidence = Math.min(0.97, confidence + 0.05);
      signals.push(`only detectable after decoding (${variant}) — concealment is itself a strong indicator`);
      if (variant !== "unicode-normalized-visible") category = "OBFUSCATED_INSTRUCTION" as ThreatCategory;
      severity = bumpSeverity(severity);
      signals.push(`original category: ${hit.rule.category}`);
    }
    if (opts.hidden) { severity = bumpSeverity(severity); confidence = Math.min(0.98, confidence + 0.05); signals.push("found in content invisible to human visitors"); }
    confidence = Math.min(0.98, Math.round(confidence * 100) / 100);
    const key = `${hit.rule.id}:${variant}:${start}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      ruleId: hit.rule.id, category, severity, variant,
      matchedText: original.slice(start, end).slice(0, 500), excerpt: excerptOf(original, start, end).slice(0, 700),
      start, end, confidence,
      explanation: `${signals[0]}. Confidence ${confidence.toFixed(2)} = rule base ${hit.rule.confidence.toFixed(2)} adjusted for: ${signals.slice(1).join("; ") || "no additional signals"}. Rule-based (deterministic) detection.`,
      recommendation: hit.rule.recommendation, signals,
    });
  };

  // 1. plain text (original offsets)
  for (const h of runRules(rawLower)) push(h, "plain", h.start, h.end);

  // 2. unicode-normalised (zero-width / homoglyph / NFKC) → map back to original offsets
  const norm = normalizeForScan(original);
  const concealed = norm.invisibleCount > 0 || norm.homoglyphCount > 0;
  for (const h of runRules(norm.text)) {
    if (rawHits.has(h.rule.id) && !concealed) continue;
    const start = norm.map[h.start] ?? 0;
    const end = (norm.map[h.end - 1] ?? original.length - 1) + 1;
    if (concealed && !seen.has(`${h.rule.id}:plain:${start}`) && !rawHits.has(h.rule.id)) push(h, "unicode-obfuscated", start, end, [`${norm.invisibleCount} invisible and ${norm.homoglyphCount} look-alike characters stripped/folded`]);
  }
  if (norm.tagDecoded.length >= 6) {
    const hits = runRules(norm.tagDecoded.toLowerCase());
    if (hits.length) for (const h of hits) push(h, "unicode-tag-smuggling", 0, Math.min(original.length, 1), ["instruction hidden in Unicode tag characters (ASCII smuggling)"]);
    else findings.push(smuggleFinding(original, norm.tagDecoded));
  }

  // 3. spaced-out letters: "i g n o r e  p r e v i o u s"
  for (const m of original.matchAll(/(?:\S[ \t._*\-|]{1,3}){9,}\S/g)) {
    const joined = m[0].replace(/[ \t._*\-|]/g, "").toLowerCase();
    const spaced = m[0].toLowerCase().replace(/\s{2,}/g, " | ");
    if (joined.length < 8 || !/^[\p{L}\p{N}]+$/u.test(joined)) continue;
    // treat wide gaps as word separators: "i g n o r e   a l l" → try both joined and word-split variants
    const words = m[0].split(/\s{2,}|\|/).map((w) => w.replace(/[ \t._*\-]/g, "")).join(" ").toLowerCase();
    for (const cand of [words, joined, spaced]) {
      for (const h of runRules(cand)) push(h, "spaced-letters", m.index!, m.index! + m[0].length, ["letters separated by spaces/punctuation to evade keyword filters"]);
    }
  }

  // 4. leetspeak, 5. rot13 — only if not already detected in plain form
  const leet = unLeet(norm.text);
  if (leet !== norm.text) for (const h of runRules(leet)) if (!rawHits.has(h.rule.id)) push(h, "leetspeak", norm.map[h.start] ?? 0, (norm.map[h.end - 1] ?? 0) + 1, ["character substitution (0→o, 3→e, @→a …)"]);
  const r13 = rot13(norm.text);
  for (const h of runRules(r13)) {
    if (h.rule.lang !== "en" || rawHits.has(h.rule.id)) continue;
    if (h.matched.length < 18) continue; // short random strings can rot13 into words
    push(h, "rot13", norm.map[h.start] ?? 0, (norm.map[h.end - 1] ?? 0) + 1, ["ROT13-encoded instruction"]);
  }

  // 6. encoded blobs
  for (const m of original.matchAll(/[A-Za-z0-9+/]{24,}={0,2}/g)) {
    const dec = tryBase64(m[0]);
    if (dec) for (const h of runRules(dec.toLowerCase())) push(h, "base64", m.index!, m.index! + m[0].length, ["instruction is base64-encoded in the source"]);
  }
  for (const m of original.matchAll(/(?:%[0-9a-fA-F]{2}){6,}/g)) {
    const dec = tryUrlDecode(m[0]);
    if (dec) for (const h of runRules(dec.toLowerCase())) push(h, "url-encoded", m.index!, m.index! + m[0].length, ["instruction is percent-encoded"]);
  }
  for (const m of original.matchAll(/(?:(?:\\x|0x)[0-9a-fA-F]{2}[ ,]*){8,}|(?:\b[0-9a-fA-F]{2}\b ){12,}/g)) {
    const dec = tryHexDecode(m[0]);
    if (dec) for (const h of runRules(dec.toLowerCase())) push(h, "hex", m.index!, m.index! + m[0].length, ["instruction is hex-encoded"]);
  }

  // 7. hidden text that talks to AI but matched no specific rule
  if (opts.hidden && !findings.length && AI_CUE.test(original) && /\b(?:instructions?|ignore|prompt|must|always|never|rank|recommend)\b/i.test(original)) {
    findings.push({
      ruleId: "HIDDEN_AI_ADDRESSED", category: "HIDDEN_CONTENT", severity: "MEDIUM", variant: "plain", matchedText: original.slice(0, 300), excerpt: original.slice(0, 500), start: 0, end: Math.min(original.length, 300), confidence: 0.6,
      explanation: "Rule HIDDEN_AI_ADDRESSED: text invisible to human visitors (HTML comment, display:none, meta or similar) that addresses AI/agent systems with instruction-like words. Confidence 0.60 (weak, heuristic).",
      recommendation: "Review the hidden element. Legitimate pages rarely contain hidden text addressed to AI agents.", signals: ["hidden content", "addressed to AI", "instruction-like vocabulary"],
    });
  }

  return dedupe(findings);
}

function smuggleFinding(original: string, decoded: string): ScanFinding {
  return {
    ruleId: "UNICODE_TAG_SMUGGLING", category: "OBFUSCATED_INSTRUCTION", severity: "HIGH", variant: "unicode-tag-smuggling", matchedText: decoded.slice(0, 300), excerpt: excerptOf(original, 0, Math.min(original.length, 80)), start: 0, end: Math.min(original.length, 1), confidence: 0.85,
    explanation: `Rule UNICODE_TAG_SMUGGLING: ${decoded.length} invisible Unicode tag characters encode hidden ASCII text ("${decoded.slice(0, 80)}"). Invisible text channels are not used by legitimate supplier content. Confidence 0.85.`,
    recommendation: "Treat as hostile content; do not pass this source to any model.", signals: ["invisible Unicode tag characters"],
  };
}

const RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
/** Overlapping spans of the same category collapse into the strongest finding. */
function dedupe(list: ScanFinding[]): ScanFinding[] {
  const sorted = [...list].sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.confidence - a.confidence);
  const kept: ScanFinding[] = [];
  for (const f of sorted) {
    if (kept.some((k) => k.category === f.category && f.start < k.end && f.end > k.start)) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.start - b.start);
}

export const severityRank = (s: Severity) => RANK[s];
export const maxSeverity = (list: { severity: Severity }[]): Severity | null => (list.length ? list.reduce((a, b) => (RANK[b.severity] > RANK[a.severity] ? b : a)).severity : null);

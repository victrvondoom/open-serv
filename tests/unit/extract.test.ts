import { describe, expect, it } from "vitest";
import { extractClaimsFromPassages, normalizePhone } from "@/lib/evidence/extract";
import { splitPassages, quoteInPassage } from "@/lib/evidence/passages";
import { buildEml } from "@/lib/rfq/eml";
import { rank, defaultWeights, type SupplierMetrics } from "@/lib/compare/scoring";
import { computeMetrics, percentile } from "@/lib/benchmarks/metrics";

describe("extraction", () => {
  it("normalises Indian phone formats", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
    expect(normalizePhone("098765 43210")).toBe("+919876543210");
    expect(normalizePhone("044-2345 6789")).toBe("+914423456789");
    expect(normalizePhone("123")).toBeNull();
  });
  it("extracts phone/email/cert/address with passage references", () => {
    const text = "Call: +91 98765 43210\nEmail us: Sales@Acme.example\nISO 9001:2015 certified\nAddress: 14 Industrial Estate, Ambattur, Chennai 600058";
    const ps = splitPassages(text).map((p) => ({ ordinal: p.ordinal, text: p.text, hidden: false }));
    const c = extractClaimsFromPassages(ps, { sourceType: "WEBSITE_PAGE" });
    expect(c.find((x) => x.type === "PHONE")?.normalized).toBe("+919876543210");
    expect(c.find((x) => x.type === "EMAIL")?.normalized).toBe("sales@acme.example");
    expect(c.find((x) => x.type === "CERTIFICATION")?.normalized).toBe("ISO9001");
    expect(c.find((x) => x.type === "ADDRESS")).toBeTruthy();
    for (const x of c) expect(quoteInPassage(x.quote, ps.find((p) => p.ordinal === x.passageOrdinal)!.text)).toBe(true);
  });
  it("never extracts claims from hidden passages", () => {
    const c = extractClaimsFromPassages([{ ordinal: 0, text: "evil@x.test +91 99999 88888", hidden: true }], { sourceType: "WEBSITE_PAGE" });
    expect(c).toEqual([]);
  });
  it("rejects fabricated quotes", () => {
    expect(quoteInPassage("ISO 14001 certified", "We are ISO 9001 certified")).toBe(false);
  });
});

describe("eml", () => {
  it("builds a valid UTF-8 message", () => {
    const eml = buildEml({ to: "a@b.test", subject: "RFQ — 316L", body: "Hello\nWorld" });
    expect(eml).toMatch(/^To: a@b\.test/m);
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(Buffer.from(eml.split("\r\n\r\n")[1].replace(/\r\n/g, ""), "base64").toString()).toContain("Hello");
  });
});

describe("scoring", () => {
  const m = (id: string, scores: Record<string, number | null>): SupplierMetrics => ({ supplierId: id, name: id, facts: { distanceKm: null, rating: null, reviewCount: null, website: null }, components: Object.fromEntries(Object.entries(defaultWeights()).map(([k]) => [k, { score: scores[k] ?? null, detail: "", refs: [] }])) as never });
  it("excludes N/A components and respects weights", () => {
    const a = m("a", { productRelevance: 100, security: 0 }), b = m("b", { productRelevance: 50, security: 100 });
    const w = { ...defaultWeights(), productRelevance: 100, security: 0 };
    expect(rank([a, b], w)[0].supplierId).toBe("a");
    const w2 = { ...defaultWeights(), productRelevance: 0, security: 100 };
    expect(rank([a, b], w2)[0].supplierId).toBe("b");
    expect(rank([a, b], defaultWeights())[0].coverage).toBeLessThan(100);
  });
});

describe("benchmark metrics", () => {
  const row = (o: object) => ({ defense: "PROXY", isAttack: true, detected: true, attackSucceeded: false, unauthorizedActionExecuted: false, secretExfilAttempted: false, secretExfilBlocked: false, taskCompleted: true, actionsProposed: 1, actionsWithProvenance: 1, actionsWithReceipt: 1, latencyMs: 2, searchRequests: 0, costUsd: null, ...o }) as never;
  it("derives precision/recall/FP from rows", () => {
    const r = computeMetrics([row({}), row({ detected: false, attackSucceeded: true }), row({ isAttack: false, detected: true }), row({ isAttack: false, detected: false })]);
    const p = r.PROXY;
    expect(p.recall).toBeCloseTo(0.5);
    expect(p.precision).toBeCloseTo(0.5);
    expect(p.falsePositiveRate).toBeCloseTo(0.5);
    expect(p.attackSuccessRate).toBeCloseTo(0.5);
    expect(percentile([1, 2, 3, 4, 100], 95)).toBe(100);
  });
});

import { prisma } from "@/lib/db";
import { tokens } from "@/lib/util";
import { normalizeWs } from "./passages";

export interface RequirementMatch {
  requirement: string;
  kind: "product" | "material_grade" | "specification" | "certification";
  status: "MATCHED" | "PARTIAL" | "NOT_ESTABLISHED";
  evidencePassageIds: string[];
  note: string;
}
export interface Relevance { score: number; matched: number; total: number; items: RequirementMatch[]; note: string }

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Compares a supplier's collected evidence to the project's requested specification.
 * A requirement is MATCHED only when the supplier's own sources contain it; otherwise NOT_ESTABLISHED (never "met").
 */
export async function computeRelevance(supplierId: string, project: { productName: string; materialGrade: string; specifications: string; requiredCertifications: string[] }): Promise<Relevance> {
  const passages = await prisma.evidencePassage.findMany({
    where: { hidden: false, document: { supplierId, sourceType: { in: ["WEBSITE_PAGE", "MAPS_LISTING", "SEARCH_SNIPPET", "MANUAL", "NEWS"] } } },
    select: { id: true, text: true },
    take: 600,
  });
  const claims = await prisma.extractedClaim.findMany({ where: { supplierId, claimType: "CERTIFICATION", reviewStatus: { not: "INCORRECT" } }, include: { evidence: { select: { passageId: true } } } });
  const sq = passages.map((p) => ({ id: p.id, s: squash(p.text), t: new Set(tokens(p.text)) }));
  const items: RequirementMatch[] = [];

  const findAll = (needle: string) => sq.filter((p) => p.s.includes(squash(needle))).map((p) => p.id);
  const tokenCoverage = (req: string) => {
    const rt = [...new Set(tokens(req))];
    if (!rt.length) return { cov: 0, ids: [] as string[], missing: rt };
    const present = new Set<string>();
    const ids = new Set<string>();
    for (const p of sq) for (const t of rt) if (p.t.has(t) || p.s.includes(t)) { present.add(t); ids.add(p.id); }
    return { cov: present.size / rt.length, ids: [...ids].slice(0, 5), missing: rt.filter((t) => !present.has(t)) };
  };

  if (project.productName.trim()) {
    const { cov, ids, missing } = tokenCoverage(project.productName);
    items.push({ requirement: project.productName, kind: "product", status: cov === 1 ? "MATCHED" : cov > 0 ? "PARTIAL" : "NOT_ESTABLISHED", evidencePassageIds: ids, note: cov === 1 ? "All product terms appear in supplier sources." : cov > 0 ? `Only some terms found; missing: ${missing.join(", ")}.` : "No supplier source mentions this product." });
  }
  if (project.materialGrade.trim()) {
    const ids = findAll(project.materialGrade);
    items.push({ requirement: project.materialGrade, kind: "material_grade", status: ids.length ? "MATCHED" : "NOT_ESTABLISHED", evidencePassageIds: ids.slice(0, 5), note: ids.length ? "Grade string appears in supplier sources." : "Grade is not stated in any collected source — do not assume it is supplied." });
  }
  const specItems = project.specifications.split(/[\n;]+/).map((s) => s.trim()).filter((s) => s.length > 2).slice(0, 12);
  for (const spec of specItems) {
    const exact = findAll(spec);
    if (exact.length) { items.push({ requirement: spec, kind: "specification", status: "MATCHED", evidencePassageIds: exact.slice(0, 5), note: "Specification text appears verbatim in supplier sources." }); continue; }
    const { cov, ids, missing } = tokenCoverage(spec);
    items.push({ requirement: spec, kind: "specification", status: cov >= 0.99 ? "PARTIAL" : cov > 0 ? "PARTIAL" : "NOT_ESTABLISHED", evidencePassageIds: ids, note: cov > 0 ? `Related terms found but the specification is not established as stated; missing terms: ${missing.join(", ") || "—"}.` : "Not mentioned in any collected source." });
  }
  for (const cert of project.requiredCertifications) {
    const nc = squash(cert);
    const hit = claims.find((c) => squash(c.normalizedValue).includes(nc) || nc.includes(squash(c.normalizedValue)));
    items.push({ requirement: cert, kind: "certification", status: hit ? "MATCHED" : "NOT_ESTABLISHED", evidencePassageIds: hit ? hit.evidence.map((e) => e.passageId).slice(0, 5) : [], note: hit ? "Certification is mentioned by the supplier (self-declared; certificate validity not verified)." : "No source mentions this certification." });
  }
  const total = items.length;
  const pts = items.reduce((a, i) => a + (i.status === "MATCHED" ? 1 : i.status === "PARTIAL" ? 0.5 : 0), 0);
  const matched = items.filter((i) => i.status === "MATCHED").length;
  return { score: total ? Math.round((pts / total) * 100) : 0, matched, total, items, note: "Coverage of the requested specification by what supplier sources state. It does not prove the supplier can meet a requirement." };
}

export { normalizeWs };

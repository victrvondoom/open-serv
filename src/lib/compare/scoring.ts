import { prisma } from "@/lib/db";
import { clamp, domainOf } from "@/lib/util";
import type { Relevance } from "@/lib/evidence/relevance";

export const COMPONENTS = [
  { key: "productRelevance", label: "Product relevance", weight: 20, help: "Share of the requested product terms found in the supplier's own sources." },
  { key: "specCoverage", label: "Specification coverage", weight: 15, help: "Requested material grade/specifications that the supplier's sources actually state (partial matches count half)." },
  { key: "distance", label: "Distance", weight: 10, help: "100 at the project location, falling linearly to 0 at the maximum search radius. Needs coordinates." },
  { key: "contactEvidence", label: "Contact evidence completeness", weight: 15, help: "Phone, email, address and website: present and corroborated scores highest; conflicting scores low." },
  { key: "certificationEvidence", label: "Certification evidence", weight: 10, help: "Required certifications mentioned in supplier sources (self-declared, not verified)." },
  { key: "websiteAvailability", label: "Website availability", weight: 5, help: "Whether the supplier's website was retrieved successfully in the latest fetch." },
  { key: "reviews", label: "Review information", weight: 5, help: "Rating shrunk toward 3.5 by review count (Bayesian average), so few reviews cannot score extremes." },
  { key: "freshness", label: "Data freshness", weight: 5, help: "Age of the most recent retrieval: ≤7 days 100, ≤30 days 80, ≤90 days 50, older 20." },
  { key: "sourceConflicts", label: "Source consistency", weight: 5, help: "Starts at 100 and loses 30 per conflicting claim. A conflict is a prompt to verify, not a verdict." },
  { key: "security", label: "Security findings", weight: 10, help: "Starts at 100 and loses points for open search-origin findings (critical 40, high 25, medium 10, low 3)." },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]["key"];
export type Weights = Record<ComponentKey, number>;
export const defaultWeights = (): Weights => Object.fromEntries(COMPONENTS.map((c) => [c.key, c.weight])) as Weights;

export interface ComponentResult { score: number | null; detail: string; refs: { type: "claim" | "document" | "finding" | "passage"; id: string }[] }
export interface SupplierMetrics { supplierId: string; name: string; components: Record<ComponentKey, ComponentResult>; facts: { distanceKm: number | null; rating: number | null; reviewCount: number | null; website: string | null } }
export interface RankedSupplier extends SupplierMetrics { total: number | null; rank: number; coverage: number }
export const DISCLAIMER = "Ranking is a prioritisation aid built from collected evidence. It is not proof of a supplier's honesty, quality or reliability. Components marked N/A had no data and are excluded from the total.";

const statusPoints: Record<string, number> = { MANUALLY_CONFIRMED: 1, CORROBORATED: 1, UNCORROBORATED: 0.65, INSUFFICIENT_EVIDENCE: 0.35, CONFLICTING: 0.4 };

export async function computeMetrics(supplierId: string, projectId?: string | null): Promise<SupplierMetrics> {
  const s = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
  const sp = projectId ? await prisma.supplierProject.findUnique({ where: { supplierId_projectId: { supplierId, projectId } }, include: { project: true } }) : null;
  const project = sp?.project ?? (projectId ? await prisma.sourcingProject.findUnique({ where: { id: projectId } }) : null);
  const [claims, docs, findings] = await Promise.all([
    prisma.extractedClaim.findMany({ where: { supplierId, reviewStatus: { not: "INCORRECT" } }, select: { id: true, claimType: true, status: true } }),
    prisma.sourceDocument.findMany({ where: { supplierId }, select: { id: true, sourceType: true, domain: true, httpStatus: true, fetchError: true, retrievedAt: true } }),
    prisma.securityFinding.findMany({ where: { supplierId, reviewStatus: { in: ["PENDING", "CONFIRMED", "REVIEWED"] } }, select: { id: true, severity: true, reviewStatus: true } }),
  ]);
  const rel = (sp?.relevance ?? null) as Relevance | null;
  const c = {} as Record<ComponentKey, ComponentResult>;
  const pts = (i: { status: string }) => (i.status === "MATCHED" ? 1 : i.status === "PARTIAL" ? 0.5 : 0);

  // relevance-based
  const prod = rel?.items.filter((i) => i.kind === "product") ?? [];
  c.productRelevance = !rel ? { score: null, detail: projectId ? "Not evaluated for this project yet — run research or add the supplier to the project." : "No project selected.", refs: [] } : prod.length ? { score: Math.round((prod.reduce((a, i) => a + pts(i), 0) / prod.length) * 100), detail: prod.map((i) => `${i.requirement}: ${i.status} — ${i.note}`).join(" "), refs: prod.flatMap((i) => i.evidencePassageIds.map((id) => ({ type: "passage" as const, id }))) } : { score: null, detail: "No product requirement on the project.", refs: [] };
  const spec = rel?.items.filter((i) => i.kind === "material_grade" || i.kind === "specification") ?? [];
  c.specCoverage = !rel ? { score: null, detail: "No project evaluation.", refs: [] } : spec.length ? { score: Math.round((spec.reduce((a, i) => a + pts(i), 0) / spec.length) * 100), detail: `${spec.filter((i) => i.status === "MATCHED").length}/${spec.length} requested specifications established by supplier sources. ${spec.filter((i) => i.status === "NOT_ESTABLISHED").map((i) => `"${i.requirement}" not established`).join("; ")}`.trim(), refs: spec.flatMap((i) => i.evidencePassageIds.map((id) => ({ type: "passage" as const, id }))) } : { score: null, detail: "No material grade or specification requested.", refs: [] };
  const cert = rel?.items.filter((i) => i.kind === "certification") ?? [];
  c.certificationEvidence = !rel ? { score: null, detail: "No project evaluation.", refs: [] } : cert.length ? { score: Math.round((cert.reduce((a, i) => a + pts(i), 0) / cert.length) * 100), detail: cert.map((i) => `${i.requirement}: ${i.status === "MATCHED" ? "mentioned (self-declared)" : "no mention found"}`).join("; "), refs: cert.flatMap((i) => i.evidencePassageIds.map((id) => ({ type: "passage" as const, id }))) } : { score: null, detail: "No certifications required by the project.", refs: [] };

  // distance
  const distanceKm = sp?.distanceKm ?? null;
  c.distance = distanceKm != null && project ? { score: Math.round(clamp(100 * (1 - distanceKm / Math.max(1, project.maxRadiusKm)), 0, 100)), detail: `${distanceKm} km from the project location (radius ${project.maxRadiusKm} km).`, refs: [] } : { score: null, detail: "Coordinates unavailable for the project or supplier.", refs: [] };

  // contact evidence
  const types = ["PHONE", "EMAIL", "ADDRESS"] as const;
  let sum = 0;
  const parts: string[] = [];
  for (const t of types) {
    const list = claims.filter((x) => x.claimType === t);
    const best = list.length ? Math.max(...list.map((x) => statusPoints[x.status] ?? 0.5)) : 0;
    sum += best;
    parts.push(`${t.toLowerCase()}: ${list.length ? [...new Set(list.map((x) => x.status))].join("/").toLowerCase() : "missing"}`);
  }
  const hasSite = !!s.website;
  sum += hasSite ? 0.65 : 0;
  parts.push(`website: ${hasSite ? "known" : "missing"}`);
  c.contactEvidence = { score: Math.round((sum / 4) * 100), detail: parts.join("; "), refs: claims.filter((x) => (types as readonly string[]).includes(x.claimType)).map((x) => ({ type: "claim" as const, id: x.id })) };

  // website availability
  const sDom = s.domain;
  const siteDocs = docs.filter((d) => d.sourceType === "WEBSITE_PAGE" && (!sDom || (d.domain && (d.domain === sDom || d.domain.endsWith(`.${sDom}`)))));
  if (!s.website) c.websiteAvailability = { score: null, detail: "No website known for this supplier.", refs: [] };
  else if (!siteDocs.length) c.websiteAvailability = { score: null, detail: "Website has not been fetched yet.", refs: [] };
  else { const latest = [...siteDocs].sort((a, b) => b.retrievedAt.getTime() - a.retrievedAt.getTime())[0]; const ok = latest.httpStatus != null && latest.httpStatus < 400 && !latest.fetchError; c.websiteAvailability = { score: ok ? 100 : 0, detail: ok ? `Latest fetch succeeded (HTTP ${latest.httpStatus}).` : `Latest fetch failed: ${latest.fetchError ?? `HTTP ${latest.httpStatus}`}.`, refs: [{ type: "document", id: latest.id }] }; }

  // reviews
  if (s.rating != null && s.reviewCount != null) { const n = s.reviewCount; const bayes = (s.rating * n + 3.5 * 10) / (n + 10); c.reviews = { score: Math.round((bayes / 5) * 100), detail: `${s.rating}★ from ${n} reviews (shrunk to ${bayes.toFixed(2)}★ for small samples). Google Maps data; unverified.`, refs: [] }; }
  else c.reviews = { score: null, detail: "No rating/review count retrieved.", refs: [] };

  // freshness
  const newest = docs.map((d) => d.retrievedAt.getTime()).sort((a, b) => b - a)[0];
  if (newest) { const days = (Date.now() - newest) / 86400_000; c.freshness = { score: days <= 7 ? 100 : days <= 30 ? 80 : days <= 90 ? 50 : 20, detail: `Most recent source retrieved ${Math.floor(days)} day(s) ago.`, refs: [] }; }
  else c.freshness = { score: null, detail: "No sources collected.", refs: [] };

  // conflicts
  const conf = claims.filter((x) => x.status === "CONFLICTING");
  c.sourceConflicts = claims.length ? { score: clamp(100 - 30 * conf.length, 0, 100), detail: conf.length ? `${conf.length} conflicting claim(s) between sources — verify before relying on them.` : "No conflicting claims recorded.", refs: conf.map((x) => ({ type: "claim" as const, id: x.id })) } : { score: null, detail: "No claims collected.", refs: [] };

  // security
  const pen: Record<string, number> = { CRITICAL: 40, HIGH: 25, MEDIUM: 10, LOW: 3, INFO: 0 };
  const open = findings.filter((f) => f.reviewStatus !== "REVIEWED" || true);
  c.security = docs.length ? { score: clamp(100 - open.reduce((a, f) => a + pen[f.severity], 0), 0, 100), detail: open.length ? `${open.length} open finding(s): ${["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((sv) => [sv, open.filter((f) => f.severity === sv).length] as const).filter(([, n]) => n).map(([sv, n]) => `${n} ${sv.toLowerCase()}`).join(", ")}.` : "No open security findings.", refs: open.map((f) => ({ type: "finding" as const, id: f.id })) } : { score: null, detail: "No sources scanned.", refs: [] };
  void domainOf;
  return { supplierId, name: s.name, components: c, facts: { distanceKm, rating: s.rating, reviewCount: s.reviewCount, website: s.website } };
}

export function rank(metrics: SupplierMetrics[], weights: Weights): RankedSupplier[] {
  const totalW = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const scored = metrics.map((m) => {
    let num = 0, den = 0;
    for (const k of Object.keys(weights) as ComponentKey[]) {
      const sc = m.components[k]?.score;
      const w = Math.max(0, weights[k] ?? 0);
      if (sc != null && w > 0) { num += sc * w; den += w; }
    }
    return { ...m, total: den ? Math.round((num / den) * 10) / 10 : null, coverage: Math.round((den / totalW) * 100), rank: 0 };
  });
  const ordered = [...scored].sort((a, b) => (b.total ?? -1) - (a.total ?? -1));
  ordered.forEach((x, i) => (x.rank = i + 1));
  return ordered;
}

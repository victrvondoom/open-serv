import type { ClaimStatus, ClaimType, SourceType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { domainOf, editDistance } from "@/lib/util";
import { FREEMAIL } from "./extract";

export type Origin = "OFFICIAL_SITE" | "MAPS" | "SEARCH" | "THIRD_PARTY_PAGE" | "REVIEW" | "NEWS" | "MANUAL" | "SYNTHETIC";
const WEAK_ORIGINS: Origin[] = ["SEARCH", "REVIEW", "NEWS", "THIRD_PARTY_PAGE"];

export function originOf(doc: { sourceType: SourceType; domain: string | null }, supplierDomain: string | null): { origin: Origin; group: string } {
  switch (doc.sourceType) {
    case "WEBSITE_PAGE":
      if (supplierDomain && doc.domain && (doc.domain === supplierDomain || doc.domain.endsWith(`.${supplierDomain}`))) return { origin: "OFFICIAL_SITE", group: "official" };
      return { origin: "THIRD_PARTY_PAGE", group: `3p:${doc.domain}` };
    case "MAPS_LISTING": return { origin: "MAPS", group: "maps" };
    case "SEARCH_SNIPPET": return { origin: "SEARCH", group: `search:${doc.domain}` };
    case "REVIEW": return { origin: "REVIEW", group: "review" };
    case "NEWS": return { origin: "NEWS", group: `news:${doc.domain}` };
    case "MANUAL": return { origin: "MANUAL", group: "manual" };
    default: return { origin: "SYNTHETIC", group: `synthetic:${doc.domain}` };
  }
}

export interface ConsistencyFinding {
  kind: "PHONE_CONFLICT" | "EMAIL_DOMAIN_MISMATCH" | "ADDRESS_MISMATCH" | "IMPERSONATION_INDICATOR" | "MISSING_CONTACT" | "STALE_RECORD" | "UNCORROBORATED_CONTACT";
  severity: "info" | "warn";
  title: string;
  explanation: string;
  claimIds: string[];
  status: ClaimStatus;
}
export interface ConsistencyReport {
  generatedAt: string;
  statusByType: Record<string, ClaimStatus>;
  findings: ConsistencyFinding[];
  disclaimer: string;
}
export const CONSISTENCY_DISCLAIMER =
  "Disagreement between sources is recorded as a conflict to investigate. It is not evidence of wrongdoing and PROXY does not classify any supplier as fraudulent.";

const addrTokens = (a: string) => new Set(a.split(" ").filter((t) => t.length > 2));
const jaccard = (a: Set<string>, b: Set<string>) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  return a.size + b.size - inter === 0 ? 1 : inter / (a.size + b.size - inter);
};
const pin = (a: string) => a.match(/\b[1-9]\d{2}\s?\d{3}\b/)?.[0].replace(/\s/g, "");
const sld = (d: string) => d.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");

interface ClaimRow {
  id: string; claimType: ClaimType; value: string; normalizedValue: string; reviewStatus: string;
  evidence: { document: { sourceType: SourceType; domain: string | null; retrievedAt: Date } }[];
}

/**
 * Recomputes the status of every claim for a supplier from its stored evidence and writes the consistency report.
 * Manual confirmations are preserved and always win.
 */
export async function reconcileSupplier(supplierId: string): Promise<ConsistencyReport> {
  const supplier = await prisma.supplier.findUniqueOrThrow({
    where: { id: supplierId },
    include: { contacts: true, claims: { include: { evidence: { include: { document: { select: { sourceType: true, domain: true, retrievedAt: true } } } } } } },
  });
  const sDomain = supplier.domain;
  const claims = supplier.claims.filter((c) => c.reviewStatus !== "INCORRECT") as unknown as ClaimRow[];
  const confirmed = new Set(supplier.contacts.filter((c) => c.confirmedAt).map((c) => `${c.type}|${c.normalizedValue}`));
  const originsOf = (c: ClaimRow) => c.evidence.map((e) => originOf(e.document, sDomain));
  const groupsOf = (c: ClaimRow) => new Set(originsOf(c).map((o) => o.group));
  const hasOrigin = (c: ClaimRow, o: Origin) => originsOf(c).some((x) => x.origin === o);

  const statusOf = new Map<string, { status: ClaimStatus; reason: string }>();
  const findings: ConsistencyFinding[] = [];
  const conflicted = new Map<string, string>();

  const byType = (t: ClaimType) => claims.filter((c) => c.claimType === t);
  const phones = byType("PHONE"), emails = byType("EMAIL"), addrs = byType("ADDRESS");

  // PHONE: official-site numbers vs maps numbers with no overlap
  const site = phones.filter((c) => hasOrigin(c, "OFFICIAL_SITE")), maps = phones.filter((c) => hasOrigin(c, "MAPS"));
  if (site.length && maps.length && !site.some((s) => maps.some((m) => m.normalizedValue === s.normalizedValue))) {
    const ids = [...site, ...maps].map((c) => c.id);
    const why = `Official website lists ${site.map((c) => c.value).join(", ")}; Google Maps listing lists ${maps.map((c) => c.value).join(", ")}; the numbers do not overlap.`;
    ids.forEach((id) => conflicted.set(id, why));
    findings.push({ kind: "PHONE_CONFLICT", severity: "warn", title: "Telephone numbers differ between sources", explanation: `${why} Verify with a call-back to a number from an independent source.`, claimIds: ids, status: "CONFLICTING" });
  }
  // EMAIL: domain checks
  const siteE = emails.filter((c) => hasOrigin(c, "OFFICIAL_SITE")), otherE = emails.filter((c) => !hasOrigin(c, "OFFICIAL_SITE"));
  const dom = (e: string) => e.split("@")[1];
  if (siteE.length && otherE.length) {
    const siteDoms = new Set(siteE.map((c) => dom(c.normalizedValue)));
    const diff = otherE.filter((c) => !siteDoms.has(dom(c.normalizedValue)));
    if (diff.length) {
      const ids = [...siteE, ...diff].map((c) => c.id);
      const why = `Official website lists ${siteE.map((c) => c.value).join(", ")}; other sources list ${diff.map((c) => c.value).join(", ")} on a different email domain.`;
      ids.forEach((id) => conflicted.set(id, why));
      findings.push({ kind: "EMAIL_DOMAIN_MISMATCH", severity: "warn", title: "Email domains differ between sources", explanation: `${why} This may be legitimate (e.g. separate sales mailbox) — confirm independently.`, claimIds: ids, status: "CONFLICTING" });
    }
  }
  // Lookalike email domains relative to the website domain
  if (sDomain) {
    for (const c of emails) {
      const d = dom(c.normalizedValue);
      if (!d || d === sDomain || d.endsWith(`.${sDomain}`) || FREEMAIL.has(d)) continue;
      const a = sld(d), b = sld(sDomain);
      if (a && b && a !== b && (editDistance(a, b) <= 2 || a.includes(b) || b.includes(a))) {
        findings.push({ kind: "IMPERSONATION_INDICATOR", severity: "warn", title: "Email domain closely resembles the website domain", explanation: `${c.value} uses domain ${d}, which is very similar to but different from the supplier's website domain ${sDomain}. Lookalike domains are a common impersonation technique, but this can also be a legitimate secondary domain. Treat as an indicator only.`, claimIds: [c.id], status: "UNCORROBORATED" });
        if (!conflicted.has(c.id)) conflicted.set(c.id, `Domain ${d} resembles ${sDomain}`);
      }
    }
  }
  // ADDRESS mismatch across origin groups
  for (let i = 0; i < addrs.length; i++)
    for (let j = i + 1; j < addrs.length; j++) {
      const a = addrs[i], b = addrs[j];
      const ga = groupsOf(a), gb = groupsOf(b);
      if ([...ga].some((g) => gb.has(g)) && ga.size === gb.size && ga.size === 1) continue; // same origin lists two addresses (branches)
      const pa = pin(a.value), pb = pin(b.value);
      const sim = jaccard(addrTokens(a.normalizedValue), addrTokens(b.normalizedValue));
      if ((pa && pb && pa !== pb) || sim < 0.25) {
        const why = `Address "${a.value}" and "${b.value}" come from different sources and ${pa && pb && pa !== pb ? `have different PIN codes (${pa} vs ${pb})` : "share little text"}.`;
        conflicted.set(a.id, why); conflicted.set(b.id, why);
        findings.push({ kind: "ADDRESS_MISMATCH", severity: "warn", title: "Addresses differ between sources", explanation: `${why} Suppliers can have multiple sites; confirm which address applies.`, claimIds: [a.id, b.id], status: "CONFLICTING" });
      } else {
        // similar addresses from independent origins → corroborate both
        void sim;
      }
    }

  // Claim statuses
  for (const c of claims) {
    const key = `${c.claimType}|${c.normalizedValue}`;
    const groups = groupsOf(c);
    if (confirmed.has(key)) { statusOf.set(c.id, { status: "MANUALLY_CONFIRMED", reason: "Confirmed by a user." }); continue; }
    if (conflicted.has(c.id) && c.claimType !== "CERTIFICATION" && c.claimType !== "PRODUCT") { statusOf.set(c.id, { status: "CONFLICTING", reason: conflicted.get(c.id)! }); continue; }
    if (groups.size >= 2) { statusOf.set(c.id, { status: "CORROBORATED", reason: `Supported by ${groups.size} independent sources.` }); continue; }
    const o = originsOf(c)[0]?.origin;
    if (!o) { statusOf.set(c.id, { status: "INSUFFICIENT_EVIDENCE", reason: "No evidence passage." }); continue; }
    if (WEAK_ORIGINS.includes(o)) statusOf.set(c.id, { status: "INSUFFICIENT_EVIDENCE", reason: `Supported only by a ${o.toLowerCase().replace(/_/g, " ")} — not enough to rely on.` });
    else statusOf.set(c.id, { status: "UNCORROBORATED", reason: `Single source (${o.toLowerCase().replace(/_/g, " ")}); no independent confirmation.` });
  }

  // Missing contact evidence
  for (const [t, list, label] of [["PHONE", phones, "telephone"], ["EMAIL", emails, "email"], ["ADDRESS", addrs, "address"]] as const) {
    if (!list.length) findings.push({ kind: "MISSING_CONTACT", severity: "info", title: `No ${label} evidence collected`, explanation: `No source retrieved so far contains a ${label} for this supplier. Status: insufficient evidence.`, claimIds: [], status: "INSUFFICIENT_EVIDENCE" });
    else if (list.every((c) => statusOf.get(c.id)?.status === "UNCORROBORATED")) findings.push({ kind: "UNCORROBORATED_CONTACT", severity: "info", title: `${label[0].toUpperCase()}${label.slice(1)} is uncorroborated`, explanation: `Every ${label} found comes from a single source type. Independent confirmation is recommended before relying on it.`, claimIds: list.map((c) => c.id), status: "UNCORROBORATED" });
    void t;
  }
  // Staleness
  const newest = claims.flatMap((c) => c.evidence.map((e) => e.document.retrievedAt.getTime())).sort((a, b) => b - a)[0];
  if (newest && Date.now() - newest > 90 * 86400_000) findings.push({ kind: "STALE_RECORD", severity: "info", title: "Evidence is more than 90 days old", explanation: "The most recent source was retrieved more than 90 days ago. Contact details may be outdated; refresh the supplier.", claimIds: [], status: "INSUFFICIENT_EVIDENCE" });

  // Persist statuses
  await prisma.$transaction(async (tx) => {
    for (const [id, s] of statusOf) await tx.extractedClaim.update({ where: { id }, data: { status: s.status, statusReason: s.reason } });
    // Mirror into denormalised contact / certification / product tables
    for (const c of claims) {
      const st = statusOf.get(c.id)!.status;
      if (c.claimType === "PHONE" || c.claimType === "EMAIL" || c.claimType === "ADDRESS" || c.claimType === "WEBSITE")
        await tx.supplierContact.upsert({
          where: { supplierId_type_normalizedValue: { supplierId, type: c.claimType, normalizedValue: c.normalizedValue } },
          update: { status: st, value: c.value }, create: { supplierId, type: c.claimType, value: c.value, normalizedValue: c.normalizedValue, status: st },
        });
      else if (c.claimType === "CERTIFICATION")
        await tx.supplierCertification.upsert({ where: { supplierId_normalizedName: { supplierId, normalizedName: c.normalizedValue } }, update: { status: st, name: c.value }, create: { supplierId, name: c.value, normalizedName: c.normalizedValue, status: st } });
      else if (c.claimType === "PRODUCT")
        await tx.supplierProduct.upsert({ where: { supplierId_normalizedName: { supplierId, normalizedName: c.normalizedValue } }, update: { claimId: c.id }, create: { supplierId, name: c.value, normalizedName: c.normalizedValue, claimId: c.id } });
    }
    // Primary contact values: strongest status, then confidence — never overwrite manual overrides
    const overrides = (supplier.manualOverrides ?? {}) as Record<string, unknown>;
    const rank: Record<ClaimStatus, number> = { MANUALLY_CONFIRMED: 5, CORROBORATED: 4, UNCORROBORATED: 3, CONFLICTING: 2, INSUFFICIENT_EVIDENCE: 1 };
    const best = (list: ClaimRow[]) => [...list].sort((a, b) => rank[statusOf.get(b.id)!.status] - rank[statusOf.get(a.id)!.status] || (originsOf(b).some((o) => o.origin === "OFFICIAL_SITE") ? 1 : 0) - (originsOf(a).some((o) => o.origin === "OFFICIAL_SITE") ? 1 : 0))[0];
    const upd: Record<string, string> = {};
    if (!overrides.phone && phones.length) upd.phone = best(phones).value;
    if (!overrides.email && emails.length) upd.email = best(emails).value;
    if (!overrides.address && addrs.length && !supplier.address) upd.address = best(addrs).value;
    const statusByType: Record<string, ClaimStatus> = {};
    for (const [t, list] of [["PHONE", phones], ["EMAIL", emails], ["ADDRESS", addrs]] as const) {
      if (!list.length) { statusByType[t] = "INSUFFICIENT_EVIDENCE"; continue; }
      const sts = list.map((c) => statusOf.get(c.id)!.status);
      statusByType[t] = sts.includes("MANUALLY_CONFIRMED") ? "MANUALLY_CONFIRMED" : sts.includes("CONFLICTING") ? "CONFLICTING" : sts.includes("CORROBORATED") ? "CORROBORATED" : sts.includes("UNCORROBORATED") ? "UNCORROBORATED" : "INSUFFICIENT_EVIDENCE";
    }
    const report: ConsistencyReport = { generatedAt: new Date().toISOString(), statusByType, findings, disclaimer: CONSISTENCY_DISCLAIMER };
    await tx.supplier.update({ where: { id: supplierId }, data: { ...upd, consistency: report as object } });
  });
  const fresh = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { consistency: true } });
  return fresh.consistency as unknown as ConsistencyReport;
}

export { domainOf };

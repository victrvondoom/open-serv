import type { ClaimType, ExtractionMethod, SourceType } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { domainOf, sha256, tokens } from "@/lib/util";
import { splitPassages, normalizeWs } from "./passages";
import { extractClaimsFromPassages, extractProductClaims, structuredJsonLdClaims, normalizeAddress, normalizeEmail, normalizePhone, type CandidateClaim, type PassageLite } from "./extract";
import { scanText } from "@/lib/security/scanner";

export interface ProviderField { type: ClaimType; value: string; normalized?: string }
export interface IngestInput {
  workspaceId: string;
  supplierId?: string | null;
  jobId?: string | null;
  searchRequestId?: string | null;
  searchResultId?: string | null;
  url: string;
  finalUrl?: string | null;
  sourceType: SourceType;
  provider: string;
  providerSearchId?: string | null;
  title?: string | null;
  httpStatus?: number | null;
  contentType?: string | null;
  text: string;
  hiddenText?: string | null;
  structured?: { headings?: string[]; listItems?: string[]; jsonLd?: unknown[]; mailto?: string[]; tel?: string[]; fields?: unknown } | null;
  contentHash?: string;
  byteLength?: number;
  fetchError?: string | null;
  isSynthetic?: boolean;
  retrievedAt?: Date;
  projectTokens?: string[];
  /** Fields supplied by a structured provider (e.g. Google Maps listing) — cited back to the rendered listing text. */
  providerFields?: ProviderField[];
}
export interface IngestResult { documentId: string; created: boolean; claimIds: string[]; findingIds: string[]; flaggedPassageIds: string[] }

const normalizeFor = (t: ClaimType, v: string) => (t === "PHONE" ? normalizePhone(v) : t === "EMAIL" ? normalizeEmail(v) : t === "ADDRESS" ? normalizeAddress(v) : normalizeWs(v));

/**
 * Stores one retrieved source with provenance (URL, provider, search id, retrieval time, SHA-256), splits it into
 * passages, extracts claims (each tied to the passage that contains it) and runs the security scanner over every
 * passage — including hidden text. Idempotent on (workspace, url, content hash).
 */
export async function ingestDocument(input: IngestInput): Promise<IngestResult> {
  const hidden = input.hiddenText ?? "";
  const contentHash = input.contentHash ?? sha256(`${input.text}\u0000${hidden}`);
  const domain = domainOf(input.finalUrl ?? input.url);

  return prisma.$transaction(
    async (tx) => {
      let doc = await tx.sourceDocument.findUnique({ where: { workspaceId_url_contentHash: { workspaceId: input.workspaceId, url: input.url, contentHash } } });
      let created = false;
      if (!doc) {
        created = true;
        doc = await tx.sourceDocument.create({
          data: {
            workspaceId: input.workspaceId, supplierId: input.supplierId ?? null, jobId: input.jobId ?? null, searchRequestId: input.searchRequestId ?? null, searchResultId: input.searchResultId ?? null,
            url: input.url, finalUrl: input.finalUrl ?? null, domain, sourceType: input.sourceType, provider: input.provider, providerSearchId: input.providerSearchId ?? null,
            title: input.title ?? null, httpStatus: input.httpStatus ?? null, contentType: input.contentType ?? null, text: input.text, hiddenText: hidden || null,
            structured: (input.structured ?? undefined) as object | undefined, contentHash, byteLength: input.byteLength ?? Buffer.byteLength(input.text), fetchError: input.fetchError ?? null,
            isSynthetic: input.isSynthetic ?? false, retrievedAt: input.retrievedAt ?? new Date(),
          },
        });
        const drafts = [...splitPassages(input.text, false), ...splitPassages(hidden, true, 700, 100000)];
        if (drafts.length)
          await tx.evidencePassage.createMany({
            data: drafts.map((d) => ({ documentId: doc!.id, ordinal: d.ordinal, text: d.text, startOffset: d.start, endOffset: d.end, hidden: d.hidden, hash: sha256(d.text) })),
            skipDuplicates: true,
          });
      } else if (!doc.supplierId && input.supplierId) {
        doc = await tx.sourceDocument.update({ where: { id: doc.id }, data: { supplierId: input.supplierId } });
      } else if (doc.supplierId === (input.supplierId ?? null) || !input.supplierId) {
        // Identical content re-verified: refresh retrieval time / status so freshness is accurate.
        await tx.sourceDocument.update({ where: { id: doc.id }, data: { retrievedAt: input.retrievedAt ?? new Date(), httpStatus: input.httpStatus ?? doc.httpStatus, fetchError: input.fetchError ?? null } });
        return { documentId: doc.id, created: false, claimIds: [], findingIds: [], flaggedPassageIds: [] };
      }

      const passages = await tx.evidencePassage.findMany({ where: { documentId: doc.id }, orderBy: { ordinal: "asc" } });
      const byOrdinal = new Map(passages.map((p) => [p.ordinal, p]));
      const lite: PassageLite[] = passages.map((p) => ({ ordinal: p.ordinal, text: p.text, hidden: p.hidden }));

      // ── Security scan over every passage (hidden text included) ──
      const findingIds: string[] = [];
      const flagged = new Set<string>();
      for (const p of passages) {
        const found = scanText(p.text, { hidden: p.hidden });
        if (!found.length) continue;
        flagged.add(p.id);
        await tx.securityFinding.createMany({
          data: found.map((f) => ({
            workspaceId: input.workspaceId, supplierId: doc!.supplierId, documentId: doc!.id, passageId: p.id, category: f.category, severity: f.severity, detectionMethod: "RULE" as const,
            ruleId: f.ruleId, matchedText: f.matchedText, excerpt: f.excerpt, startOffset: f.start, endOffset: f.end, variant: f.variant, confidence: f.confidence, explanation: f.explanation,
            recommendation: f.recommendation, isSynthetic: doc!.isSynthetic,
          })),
          skipDuplicates: true,
        });
      }
      if (flagged.size) {
        const rows = await tx.securityFinding.findMany({ where: { documentId: doc.id }, select: { id: true } });
        findingIds.push(...rows.map((r) => r.id));
      }

      // ── Claim extraction (only when attached to a supplier) ──
      const claimIds: string[] = [];
      const supplierId = doc.supplierId;
      if (supplierId) {
        const cands: CandidateClaim[] = [];
        const s = (doc.structured ?? {}) as { headings?: string[]; listItems?: string[]; jsonLd?: unknown[]; mailto?: string[]; tel?: string[] };
        cands.push(...extractClaimsFromPassages(lite, { sourceType: doc.sourceType, mailto: s.mailto, tel: s.tel }));
        if (s.jsonLd?.length) cands.push(...structuredJsonLdClaims(s.jsonLd, lite));
        const pt = input.projectTokens ?? [];
        if (doc.sourceType === "WEBSITE_PAGE") {
          const names = [...(s.headings ?? []), ...(s.listItems ?? [])];
          cands.push(...extractProductClaims(lite, names, pt, "HTML_STRUCTURED"));
        }
        for (const f of input.providerFields ?? []) {
          const norm = f.normalized ?? normalizeFor(f.type, f.value);
          const p = passages.find((pp) => !pp.hidden && normalizeWs(pp.text).includes(normalizeWs(f.value)));
          if (norm && p) cands.push({ type: f.type, value: f.value, normalized: norm, passageOrdinal: p.ordinal, quote: f.value, method: "STRUCTURED_PROVIDER", confidence: 0.85 });
        }
        for (const c of cands) {
          const p = byOrdinal.get(c.passageOrdinal);
          if (!p) continue;
          const claim = await tx.extractedClaim.upsert({
            where: { supplierId_claimType_normalizedValue: { supplierId, claimType: c.type, normalizedValue: c.normalized } },
            update: { confidence: { set: c.confidence } },
            create: { workspaceId: input.workspaceId, supplierId, claimType: c.type, value: c.value, normalizedValue: c.normalized, confidence: c.confidence, extractionMethod: c.method, limitations: limitationFor(doc.sourceType, c.type) },
          });
          await tx.claimEvidence.createMany({ data: [{ claimId: claim.id, documentId: doc.id, passageId: p.id, extractionMethod: c.method, quote: c.quote.slice(0, 500) }], skipDuplicates: true });
          claimIds.push(claim.id);
        }
      }
      return { documentId: doc.id, created, claimIds: [...new Set(claimIds)], findingIds, flaggedPassageIds: [...flagged] };
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
}

export function limitationFor(src: SourceType, type: ClaimType): string {
  const base: Record<string, string> = {
    WEBSITE_PAGE: "Self-declared on the supplier's own web page; not independently verified.",
    MAPS_LISTING: "Taken from a Google Maps listing, which may be edited by the owner or third parties.",
    SEARCH_SNIPPET: "Taken from a search-result snippet only; the underlying page was not verified.",
    REVIEW: "Taken from a user review; unverified and may be inaccurate or planted.",
    NEWS: "Taken from a news item; relevance to current contact details is unverified.",
    MANUAL: "Entered manually by a user.", SYNTHETIC: "Synthetic test fixture — not live supplier data.",
  };
  return `${base[src] ?? ""}${type === "CERTIFICATION" ? " A mention of a certification is not proof that a valid certificate exists." : ""}`.trim();
}

export async function listFindingsForDocument(tx: Pick<Tx, "securityFinding">, documentId: string) {
  return tx.securityFinding.findMany({ where: { documentId } });
}

export { tokens };

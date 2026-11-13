import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { reconcileSupplier } from "./reconcile";

const filtersZ = z.object({
  q: z.string().optional(), supplierId: z.string().optional(), projectId: z.string().optional(), sourceType: z.string().optional(), from: z.string().optional(), to: z.string().optional(), threat: z.string().optional(), hidden: z.enum(["yes", "no"]).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function searchEvidence(ctx: Ctx, raw: Record<string, unknown>) {
  const f = filtersZ.parse(raw);
  const doc: Prisma.SourceDocumentWhereInput = {
    workspaceId: ctx.workspaceId, ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.sourceType ? { sourceType: f.sourceType as never } : {}),
    ...(f.projectId ? { supplier: { projects: { some: { projectId: f.projectId } } } } : {}),
    ...(f.from || f.to ? { retrievedAt: { ...(f.from ? { gte: new Date(f.from) } : {}), ...(f.to ? { lte: new Date(`${f.to}T23:59:59Z`) } : {}) } } : {}),
  };
  const where: Prisma.EvidencePassageWhereInput = { document: doc, ...(f.q ? { text: { contains: f.q, mode: "insensitive" } } : {}), ...(f.threat ? { findings: { some: { category: f.threat as never } } } : {}), ...(f.hidden ? { hidden: f.hidden === "yes" } : {}) };
  const [items, total] = await Promise.all([
    prisma.evidencePassage.findMany({ where, orderBy: [{ document: { retrievedAt: "desc" } }, { ordinal: "asc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { document: { select: { id: true, url: true, sourceType: true, retrievedAt: true, contentHash: true, provider: true, providerSearchId: true, isSynthetic: true, supplier: { select: { id: true, name: true } } } }, evidence: { select: { claim: { select: { id: true, claimType: true, value: true, status: true, reviewStatus: true } }, quote: true, extractionMethod: true } }, findings: { select: { id: true, category: true, severity: true, reviewStatus: true } } } }),
    prisma.evidencePassage.count({ where }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize };
}

export async function getSource(ctx: Ctx, id: string) {
  const d = await prisma.sourceDocument.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { passages: { orderBy: { ordinal: "asc" }, include: { findings: { select: { id: true, category: true, severity: true, startOffset: true, endOffset: true, reviewStatus: true } }, evidence: { select: { claim: { select: { id: true, claimType: true, value: true, status: true } }, quote: true } } } }, supplier: { select: { id: true, name: true } }, searchRequest: { select: { id: true, engine: true, query: true, providerSearchId: true, requestedAt: true } } } });
  if (!d) throw notFound("Source");
  return d;
}

export async function listConflicts(ctx: Ctx, opts: { supplierId?: string; projectId?: string }) {
  const claims = await prisma.extractedClaim.findMany({
    where: { workspaceId: ctx.workspaceId, status: "CONFLICTING", reviewStatus: { not: "INCORRECT" }, ...(opts.supplierId ? { supplierId: opts.supplierId } : {}), ...(opts.projectId ? { supplier: { projects: { some: { projectId: opts.projectId } } } } : {}) },
    include: { supplier: { select: { id: true, name: true } }, evidence: { include: { document: { select: { id: true, url: true, sourceType: true, retrievedAt: true } }, passage: { select: { id: true, text: true } } } } }, orderBy: [{ supplierId: "asc" }, { claimType: "asc" }], take: 200,
  });
  const groups = new Map<string, { supplier: { id: string; name: string }; claimType: string; claims: typeof claims }>();
  for (const c of claims) { const k = `${c.supplierId}|${c.claimType}`; if (!groups.has(k)) groups.set(k, { supplier: c.supplier, claimType: c.claimType, claims: [] }); groups.get(k)!.claims.push(c); }
  return [...groups.values()];
}

const reviewZ = z.object({ reviewStatus: z.enum(["UNREVIEWED", "REVIEWED", "INCORRECT"]), note: z.string().max(2000).optional() });
export async function reviewClaim(ctx: Ctx, id: string, raw: unknown) {
  const p = reviewZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid review", p.error.flatten());
  const c = await prisma.extractedClaim.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!c) throw notFound("Claim");
  const u = await prisma.extractedClaim.update({ where: { id }, data: { reviewStatus: p.data.reviewStatus, reviewerNote: p.data.note ?? c.reviewerNote, reviewedAt: new Date() } });
  await reconcileSupplier(c.supplierId); // an extraction marked incorrect no longer counts as evidence
  await audit(ctx, "claim.reviewed", "ExtractedClaim", id, { reviewStatus: p.data.reviewStatus, note: p.data.note });
  return u;
}

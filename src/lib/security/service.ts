import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { ingestDocument } from "@/lib/evidence/ingest";
import { sha256 } from "@/lib/util";

export const findingFilters = z.object({
  q: z.string().optional(), status: z.string().optional(), severity: z.string().optional(), category: z.string().optional(), supplierId: z.string().optional(), method: z.string().optional(), synthetic: z.enum(["yes", "no"]).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function listFindings(ctx: Ctx, raw: Record<string, unknown>) {
  const f = findingFilters.parse(raw);
  const where: Prisma.SecurityFindingWhereInput = {
    workspaceId: ctx.workspaceId,
    ...(f.status ? { reviewStatus: f.status as never } : {}), ...(f.severity ? { severity: f.severity as never } : {}), ...(f.category ? { category: f.category as never } : {}), ...(f.supplierId ? { supplierId: f.supplierId } : {}), ...(f.method ? { detectionMethod: f.method as never } : {}),
    ...(f.synthetic ? { isSynthetic: f.synthetic === "yes" } : {}), ...(f.q ? { OR: [{ matchedText: { contains: f.q, mode: "insensitive" } }, { excerpt: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total, bySeverity, byStatus] = await Promise.all([
    prisma.securityFinding.findMany({ where, orderBy: [{ createdAt: "desc" }], skip: (f.page - 1) * f.pageSize, take: f.pageSize, include: { supplier: { select: { id: true, name: true } }, document: { select: { id: true, url: true, sourceType: true } } } }),
    prisma.securityFinding.count({ where }),
    prisma.securityFinding.groupBy({ by: ["severity"], where: { workspaceId: ctx.workspaceId }, _count: true }),
    prisma.securityFinding.groupBy({ by: ["reviewStatus"], where: { workspaceId: ctx.workspaceId }, _count: true }),
  ]);
  return { items, total, page: f.page, pageSize: f.pageSize, bySeverity, byStatus };
}

export async function getFinding(ctx: Ctx, id: string) {
  const f = await prisma.securityFinding.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { supplier: { select: { id: true, name: true } }, document: true, passage: true, reviews: { orderBy: { createdAt: "desc" } }, proposal: true } });
  if (!f) throw notFound("Finding");
  // action proposals that referenced the same source document
  const proposals = await prisma.actionProposal.findMany({ where: { workspaceId: ctx.workspaceId, sourceRefs: { array_contains: [{ sourceId: f.documentId }] } }, orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []);
  return { ...f, relatedProposals: proposals };
}

const reviewInput = z.object({ decision: z.enum(["REVIEWED", "CONFIRMED", "DISMISSED", "FALSE_POSITIVE"]), note: z.string().max(2000).optional() });

export async function reviewFinding(ctx: Ctx, id: string, raw: unknown) {
  const parsed = reviewInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid review", parsed.error.flatten());
  const f = await prisma.securityFinding.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!f) throw notFound("Finding");
  const [review] = await prisma.$transaction([
    prisma.securityReview.create({ data: { findingId: id, userId: ctx.userId, decision: parsed.data.decision, note: parsed.data.note } }),
    prisma.securityFinding.update({ where: { id }, data: { reviewStatus: parsed.data.decision } }),
  ]);
  await audit(ctx, "finding.reviewed", "SecurityFinding", id, { decision: parsed.data.decision, note: parsed.data.note });
  return review;
}

const ingestInput = z.object({
  supplierId: z.string().optional(), title: z.string().max(200).default("Synthetic source"), url: z.string().url().default("https://synthetic.invalid/source"),
  content: z.string().min(1).max(200_000), hiddenContent: z.string().max(100_000).optional(), sourceType: z.enum(["SYNTHETIC", "MANUAL"]).default("SYNTHETIC"),
});

/**
 * Source-ingestion pipeline for externally supplied content (used for synthetic fixtures and manual evidence).
 * The content goes through the exact same passage-splitting, extraction and security scan as retrieved pages.
 */
export async function ingestSource(ctx: Ctx, raw: unknown) {
  const parsed = ingestInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid source", parsed.error.flatten());
  const d = parsed.data;
  if (d.supplierId) {
    const s = await prisma.supplier.findFirst({ where: { id: d.supplierId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!s) throw notFound("Supplier");
  }
  const res = await ingestDocument({ workspaceId: ctx.workspaceId, supplierId: d.supplierId ?? null, url: d.url, sourceType: d.sourceType, provider: d.sourceType === "SYNTHETIC" ? "synthetic-fixture" : "manual", title: d.title, text: d.content, hiddenText: d.hiddenContent, contentHash: sha256(`${d.content}\u0000${d.hiddenContent ?? ""}`), isSynthetic: d.sourceType === "SYNTHETIC" });
  if (d.supplierId) { const { reconcileSupplier } = await import("@/lib/evidence/reconcile"); await reconcileSupplier(d.supplierId); }
  await audit(ctx, "source.ingested", "SourceDocument", res.documentId, { synthetic: d.sourceType === "SYNTHETIC", findings: res.findingIds.length });
  const findings = await prisma.securityFinding.findMany({ where: { documentId: res.documentId } });
  return { ...res, treatedAs: "UNTRUSTED_THIRD_PARTY_CONTENT", findings };
}

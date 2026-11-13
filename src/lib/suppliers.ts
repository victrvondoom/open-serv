import { z } from "zod";
import type { ClaimType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { assertAllowed, runAction } from "@/lib/actions/controller";
import { domainOf, haversineKm, normalizeName, sha256 } from "@/lib/util";
import { ingestDocument } from "@/lib/evidence/ingest";
import { normalizeAddress, normalizeEmail, normalizePhone } from "@/lib/evidence/extract";
import { reconcileSupplier } from "@/lib/evidence/reconcile";
import { computeRelevance } from "@/lib/evidence/relevance";

export const supplierFilters = z.object({
  q: z.string().optional(), location: z.string().optional(), category: z.string().optional(), projectId: z.string().optional(),
  evidence: z.enum(["complete", "partial", "incomplete"]).optional(), security: z.enum(["open", "any", "none"]).optional(), conflicts: z.enum(["yes", "no"]).optional(),
  tag: z.string().optional(), sort: z.enum(["match", "distance", "recent", "name"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type SupplierFilters = z.infer<typeof supplierFilters>;

export function buildSupplierWhere(ctx: Pick<Ctx, "workspaceId">, f: SupplierFilters): Prisma.SupplierWhereInput {
  const and: Prisma.SupplierWhereInput[] = [{ workspaceId: ctx.workspaceId }];
  if (f.q) and.push({ OR: [{ name: { contains: f.q, mode: "insensitive" } }, { domain: { contains: f.q, mode: "insensitive" } }] });
  if (f.location) and.push({ OR: [{ city: { contains: f.location, mode: "insensitive" } }, { state: { contains: f.location, mode: "insensitive" } }, { address: { contains: f.location, mode: "insensitive" } }, { country: { contains: f.location, mode: "insensitive" } }] });
  if (f.category) and.push({ category: { contains: f.category, mode: "insensitive" } });
  if (f.projectId) and.push({ projects: { some: { projectId: f.projectId } } });
  if (f.tag) and.push({ tags: { has: f.tag } });
  if (f.evidence === "complete") and.push({ phone: { not: null }, email: { not: null }, address: { not: null }, website: { not: null } });
  if (f.evidence === "incomplete") and.push({ OR: [{ phone: null }, { email: null }, { address: null }, { website: null }] });
  if (f.evidence === "partial") and.push({ OR: [{ phone: null }, { email: null }, { address: null }, { website: null }] }, { OR: [{ phone: { not: null } }, { email: { not: null } }, { address: { not: null } }, { website: { not: null } }] });
  const open: Prisma.SecurityFindingWhereInput = { reviewStatus: { in: ["PENDING", "CONFIRMED"] }, severity: { in: ["MEDIUM", "HIGH", "CRITICAL"] } };
  if (f.security === "open") and.push({ findings: { some: open } });
  if (f.security === "any") and.push({ findings: { some: {} } });
  if (f.security === "none") and.push({ findings: { none: {} } });
  if (f.conflicts === "yes") and.push({ claims: { some: { status: "CONFLICTING" } } });
  if (f.conflicts === "no") and.push({ claims: { none: { status: "CONFLICTING" } } });
  return { AND: and };
}

export async function listSuppliers(ctx: Ctx, f: SupplierFilters) {
  const where = buildSupplierWhere(ctx, f);
  const skip = (f.page - 1) * f.pageSize;
  let rows: { supplier: Awaited<ReturnType<typeof prisma.supplier.findMany>>[number]; matchScore: number | null; distanceKm: number | null }[];
  let total: number;

  if (f.projectId && (f.sort === "match" || f.sort === "distance")) {
    const spWhere: Prisma.SupplierProjectWhereInput = { projectId: f.projectId, supplier: where };
    const orderBy: Prisma.SupplierProjectOrderByWithRelationInput[] = f.sort === "match" ? [{ matchScore: { sort: "desc", nulls: "last" } }, { savedAt: "desc" }] : [{ distanceKm: { sort: "asc", nulls: "last" } }, { savedAt: "desc" }];
    const [sps, count] = await Promise.all([prisma.supplierProject.findMany({ where: spWhere, orderBy, skip, take: f.pageSize, include: { supplier: true } }), prisma.supplierProject.count({ where: spWhere })]);
    rows = sps.map((sp) => ({ supplier: sp.supplier, matchScore: sp.matchScore, distanceKm: sp.distanceKm }));
    total = count;
  } else {
    const orderBy: Prisma.SupplierOrderByWithRelationInput[] = f.sort === "name" ? [{ name: "asc" }] : [{ lastResearchedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }];
    const [sups, count] = await Promise.all([prisma.supplier.findMany({ where, orderBy, skip, take: f.pageSize }), prisma.supplier.count({ where })]);
    const sps = f.projectId ? await prisma.supplierProject.findMany({ where: { projectId: f.projectId, supplierId: { in: sups.map((s) => s.id) } } }) : [];
    rows = sups.map((s) => { const sp = sps.find((x) => x.supplierId === s.id); return { supplier: s, matchScore: sp?.matchScore ?? null, distanceKm: sp?.distanceKm ?? null }; });
    total = count;
  }
  const ids = rows.map((r) => r.supplier.id);
  const [findings, conflicts, projects] = await Promise.all([
    prisma.securityFinding.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, reviewStatus: { in: ["PENDING", "CONFIRMED"] }, severity: { in: ["MEDIUM", "HIGH", "CRITICAL"] } }, _count: true }),
    prisma.extractedClaim.groupBy({ by: ["supplierId"], where: { supplierId: { in: ids }, status: "CONFLICTING" }, _count: true }),
    prisma.supplierProject.findMany({ where: { supplierId: { in: ids } }, select: { supplierId: true, project: { select: { id: true, name: true } } } }),
  ]);
  const items = rows.map((r) => ({
    ...r.supplier, matchScore: r.matchScore, distanceKm: r.distanceKm,
    openFindings: findings.find((x) => x.supplierId === r.supplier.id)?._count ?? 0,
    conflictingClaims: conflicts.find((x) => x.supplierId === r.supplier.id)?._count ?? 0,
    projectsList: projects.filter((p) => p.supplierId === r.supplier.id).map((p) => p.project),
    evidenceCompleteness: [r.supplier.phone, r.supplier.email, r.supplier.address, r.supplier.website].filter(Boolean).length,
  }));
  return { items, total, page: f.page, pageSize: f.pageSize };
}

export async function getSupplierDetail(ctx: Ctx, id: string) {
  const s = await prisma.supplier.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!s) throw notFound("Supplier");
  const [projects, claims, documents, findings, results, products, certs] = await Promise.all([
    prisma.supplierProject.findMany({ where: { supplierId: id }, include: { project: true }, orderBy: { savedAt: "desc" } }),
    prisma.extractedClaim.findMany({ where: { supplierId: id }, orderBy: [{ claimType: "asc" }, { createdAt: "asc" }], include: { evidence: { include: { document: { select: { id: true, url: true, sourceType: true, retrievedAt: true, contentHash: true, provider: true, providerSearchId: true } }, passage: { select: { id: true, text: true, ordinal: true } } } } } }),
    prisma.sourceDocument.findMany({ where: { supplierId: id }, orderBy: { retrievedAt: "desc" }, select: { id: true, url: true, finalUrl: true, title: true, sourceType: true, provider: true, providerSearchId: true, httpStatus: true, contentHash: true, retrievedAt: true, fetchError: true, byteLength: true, isSynthetic: true, _count: { select: { passages: true, findings: true } } } }),
    prisma.securityFinding.findMany({ where: { supplierId: id }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }], take: 50, select: { id: true, category: true, severity: true, reviewStatus: true, matchedText: true, documentId: true, detectionMethod: true } }),
    prisma.searchResult.findMany({ where: { supplierId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { request: { select: { id: true, engine: true, query: true, providerSearchId: true, requestedAt: true, cacheHit: true } } } }),
    prisma.supplierProduct.findMany({ where: { supplierId: id }, orderBy: { name: "asc" } }),
    prisma.supplierCertification.findMany({ where: { supplierId: id }, orderBy: { name: "asc" } }),
  ]);
  return { supplier: s, projects, claims, documents, findings, results, products, certifications: certs };
}

const manualFields = z.object({
  name: z.string().trim().min(2).max(200).optional(), category: z.string().trim().max(200).nullable().optional(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: z.string().max(10000).optional(), website: z.string().trim().max(300).nullable().optional(), city: z.string().max(120).nullable().optional(), state: z.string().max(120).nullable().optional(),
});

export async function updateSupplier(ctx: Ctx, id: string, raw: unknown) {
  const parsed = manualFields.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid supplier update", parsed.error.flatten());
  const s = await prisma.supplier.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!s) throw notFound("Supplier");
  const d = parsed.data;
  const data: Prisma.SupplierUpdateInput = {};
  if (d.name) { data.name = d.name; data.normalizedName = normalizeName(d.name); }
  if (d.category !== undefined) data.category = d.category;
  if (d.tags) data.tags = [...new Set(d.tags)];
  if (d.website !== undefined) { data.website = d.website; data.domain = domainOf(d.website); }
  if (d.city !== undefined) data.city = d.city;
  if (d.state !== undefined) data.state = d.state;
  if (d.notes !== undefined) {
    const r = await runAction(ctx, { actionType: "UPDATE_SUPPLIER_NOTES", actorType: "USER", params: { supplierId: id, length: d.notes.length }, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] }, () => prisma.supplier.update({ where: { id }, data: { notes: d.notes } }));
    assertAllowed(r);
  }
  const u = Object.keys(data).length ? await prisma.supplier.update({ where: { id }, data }) : await prisma.supplier.findUniqueOrThrow({ where: { id } });
  await audit(ctx, "supplier.updated", "Supplier", id, { fields: Object.keys(d) });
  return u;
}

export async function createManualSupplier(ctx: Ctx, raw: unknown, projectId?: string) {
  const parsed = z.object({ name: z.string().trim().min(2).max(200), website: z.string().trim().max(300).optional(), category: z.string().trim().max(200).optional(), city: z.string().trim().max(120).optional(), state: z.string().trim().max(120).optional(), country: z.string().trim().max(120).optional() }).safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid supplier", parsed.error.flatten());
  const d = parsed.data;
  const domain = domainOf(d.website);
  const identityKey = domain ? `domain:${domain}` : `name:${normalizeName(d.name)}|${normalizeName(d.city ?? "")}`;
  const existing = await prisma.supplier.findUnique({ where: { workspaceId_identityKey: { workspaceId: ctx.workspaceId, identityKey } } });
  if (existing) throw conflict("A supplier with the same website/name already exists.", { supplierId: existing.id });
  const r = await runAction(ctx, { actionType: "CREATE_SUPPLIER_RECORD", actorType: "USER", params: { name: d.name, manual: true }, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] },
    () => prisma.supplier.create({ data: { workspaceId: ctx.workspaceId, name: d.name, normalizedName: normalizeName(d.name), identityKey, website: d.website, domain, category: d.category, city: d.city, state: d.state, country: d.country } }));
  assertAllowed(r);
  if (projectId) await addSupplierToProject(ctx, r.result!.id, projectId);
  await audit(ctx, "supplier.created", "Supplier", r.result!.id, { manual: true });
  return r.result!;
}

export async function deleteSupplier(ctx: Ctx, id: string) {
  const s = await prisma.supplier.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!s) throw notFound("Supplier");
  await prisma.supplier.delete({ where: { id } });
  await audit(ctx, "supplier.deleted", "Supplier", id, { name: s.name });
}

export async function addSupplierToProject(ctx: Ctx, supplierId: string, projectId: string) {
  const [s, p] = await Promise.all([prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: ctx.workspaceId } }), prisma.sourcingProject.findFirst({ where: { id: projectId, workspaceId: ctx.workspaceId } })]);
  if (!s) throw notFound("Supplier");
  if (!p) throw notFound("Project");
  const rel = await computeRelevance(supplierId, p);
  const distanceKm = p.latitude != null && p.longitude != null && s.latitude != null && s.longitude != null ? Math.round(haversineKm({ lat: p.latitude, lng: p.longitude }, { lat: s.latitude, lng: s.longitude }) * 10) / 10 : null;
  const sp = await prisma.supplierProject.upsert({ where: { supplierId_projectId: { supplierId, projectId } }, update: { matchScore: rel.score, relevance: rel as unknown as object, distanceKm }, create: { supplierId, projectId, matchScore: rel.score, relevance: rel as unknown as object, distanceKm } });
  await audit(ctx, "supplier.project_added", "Supplier", supplierId, { projectId });
  return sp;
}
export async function removeSupplierFromProject(ctx: Ctx, supplierId: string, projectId: string) {
  const s = await prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!s) throw notFound("Supplier");
  await prisma.supplierProject.deleteMany({ where: { supplierId, projectId } });
  await audit(ctx, "supplier.project_removed", "Supplier", supplierId, { projectId });
}

/** User-confirms an existing claim (e.g. after calling the supplier). Confirmation is explicit, attributed and audited. */
export async function confirmClaim(ctx: Ctx, supplierId: string, claimId: string, confirm = true) {
  const claim = await prisma.extractedClaim.findFirst({ where: { id: claimId, supplierId, workspaceId: ctx.workspaceId } });
  if (!claim) throw notFound("Claim");
  if (!["PHONE", "EMAIL", "ADDRESS", "WEBSITE"].includes(claim.claimType)) throw badRequest("Only contact claims can be manually confirmed.");
  await prisma.supplierContact.upsert({
    where: { supplierId_type_normalizedValue: { supplierId, type: claim.claimType, normalizedValue: claim.normalizedValue } },
    update: confirm ? { confirmedAt: new Date(), confirmedBy: ctx.userId } : { confirmedAt: null, confirmedBy: null },
    create: { supplierId, type: claim.claimType, value: claim.value, normalizedValue: claim.normalizedValue, ...(confirm ? { confirmedAt: new Date(), confirmedBy: ctx.userId } : {}) },
  });
  await reconcileSupplier(supplierId);
  await audit(ctx, confirm ? "claim.confirmed" : "claim.unconfirmed", "ExtractedClaim", claimId, { supplierId, type: claim.claimType });
}

/** Adds a user-entered contact as a MANUAL source with a real passage, so it is traceable like any other claim. */
export async function addManualContact(ctx: Ctx, supplierId: string, type: ClaimType, value: string, note?: string) {
  const s = await prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: ctx.workspaceId } });
  if (!s) throw notFound("Supplier");
  const v = value.trim();
  const normalized = type === "PHONE" ? normalizePhone(v) : type === "EMAIL" ? (/@/.test(v) ? normalizeEmail(v) : null) : type === "ADDRESS" ? normalizeAddress(v) : null;
  if (!normalized) throw badRequest(`"${value}" is not a valid ${type.toLowerCase()}.`);
  const text = `${type === "PHONE" ? "Phone" : type === "EMAIL" ? "Email" : "Address"}: ${v}\nEntered manually by ${ctx.userEmail}${note ? `\nNote: ${note}` : ""}`;
  const ing = await ingestDocument({ workspaceId: ctx.workspaceId, supplierId, url: `manual://supplier/${supplierId}/${type.toLowerCase()}`, sourceType: "MANUAL", provider: "manual", title: "Manual entry", text, contentHash: sha256(text + normalized), providerFields: [{ type, value: v, normalized }] });
  const claim = await prisma.extractedClaim.findFirst({ where: { supplierId, claimType: type, normalizedValue: normalized } });
  if (claim) await confirmClaim(ctx, supplierId, claim.id, true);
  await audit(ctx, "supplier.manual_contact", "Supplier", supplierId, { type });
  return ing;
}

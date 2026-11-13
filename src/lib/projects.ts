import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { assertAllowed, runAction } from "@/lib/actions/controller";

const list = z.preprocess((v) => (typeof v === "string" ? v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean) : v), z.array(z.string().max(120)).max(30)).default([]);
const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : Number(v)), z.number().positive().max(1e12).optional());

export const projectInput = z.object({
  name: z.string().trim().min(2, "Project name is required").max(120),
  productName: z.string().trim().min(2, "Product or material name is required").max(200),
  description: z.string().trim().min(10, "Describe the product you need (at least 10 characters)").max(5000),
  specifications: z.string().trim().max(5000).default(""),
  materialGrade: z.string().trim().max(200).default(""),
  quantity: optNum,
  unit: z.string().trim().max(40).default(""),
  deliveryLocation: z.string().trim().max(300).default(""),
  city: z.string().trim().min(1, "City is required").max(120),
  state: z.string().trim().max(120).default(""),
  country: z.string().trim().min(2, "Country is required").max(120).default("India"),
  maxRadiusKm: z.preprocess((v) => (v === "" || v == null ? 100 : Number(v)), z.number().int().min(1).max(5000)).default(100),
  requiredCertifications: list,
  additionalRequirements: z.string().trim().max(5000).default(""),
  preferredSupplierType: z.string().trim().max(120).default(""),
  excludedSuppliers: list,
});
export type ProjectInput = z.infer<typeof projectInput>;
export const projectPatch = projectInput.partial();

const REQUIREMENT_FIELDS = ["productName", "description", "specifications", "materialGrade", "quantity", "unit", "city", "state", "country", "requiredCertifications", "additionalRequirements"] as const;

export async function listProjects(ctx: Ctx, opts: { q?: string; status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page ?? 1), pageSize = Math.min(100, opts.pageSize ?? 20);
  const where: Prisma.SourcingProjectWhereInput = { workspaceId: ctx.workspaceId, ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { productName: { contains: opts.q, mode: "insensitive" } }, { city: { contains: opts.q, mode: "insensitive" } }] } : {}), ...(opts.status ? { status: opts.status as never } : {}) };
  const [items, total] = await Promise.all([
    prisma.sourcingProject.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { suppliers: true, rfqs: true } }, jobs: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, createdAt: true } } } }),
    prisma.sourcingProject.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function getProject(ctx: Ctx, id: string) {
  const p = await prisma.sourcingProject.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!p) throw notFound("Project");
  return p;
}

export async function createProject(ctx: Ctx, raw: unknown) {
  const parsed = projectInput.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid project", parsed.error.flatten());
  const p = await prisma.sourcingProject.create({ data: { ...parsed.data, workspaceId: ctx.workspaceId } });
  await audit(ctx, "project.created", "SourcingProject", p.id, { name: p.name });
  return p;
}

export async function updateProject(ctx: Ctx, id: string, raw: unknown) {
  const parsed = projectPatch.safeParse(raw);
  if (!parsed.success) throw badRequest("Invalid project", parsed.error.flatten());
  const existing = await getProject(ctx, id);
  const changed = REQUIREMENT_FIELDS.filter((k) => k in parsed.data && JSON.stringify((parsed.data as Record<string, unknown>)[k]) !== JSON.stringify((existing as Record<string, unknown>)[k]));
  const locChanged = ["city", "state", "country"].some((k) => k in parsed.data && (parsed.data as Record<string, unknown>)[k] !== (existing as Record<string, unknown>)[k]);
  const run = await runAction(ctx, { actionType: "MODIFY_PROJECT_REQUIREMENTS", actorType: "USER", params: { projectId: id, changedFields: changed }, userConfirmed: true, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] },
    () => prisma.sourcingProject.update({ where: { id }, data: { ...parsed.data, ...(locChanged ? { latitude: null, longitude: null } : {}) } }));
  assertAllowed(run);
  await audit(ctx, "project.updated", "SourcingProject", id, { changedFields: changed });
  return run.result!;
}

export async function duplicateProject(ctx: Ctx, id: string) {
  const p = await getProject(ctx, id);
  const { id: _id, createdAt: _c, updatedAt: _u, status: _s, ...rest } = p;
  void _id; void _c; void _u; void _s;
  const copy = await prisma.sourcingProject.create({ data: { ...rest, name: `${p.name} (copy)`, status: "DRAFT" } });
  await audit(ctx, "project.duplicated", "SourcingProject", copy.id, { from: id });
  return copy;
}

export async function deleteProject(ctx: Ctx, id: string) {
  await getProject(ctx, id);
  await prisma.sourcingProject.delete({ where: { id } });
  await audit(ctx, "project.deleted", "SourcingProject", id);
}

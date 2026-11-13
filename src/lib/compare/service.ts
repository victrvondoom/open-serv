import PDFDocument from "pdfkit";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { assertAllowed, runAction } from "@/lib/actions/controller";
import { COMPONENTS, DISCLAIMER, computeMetrics, defaultWeights, rank, type RankedSupplier, type Weights } from "./scoring";

const weightsZ = z.record(z.string(), z.number().min(0).max(100));
const createZ = z.object({ name: z.string().trim().min(1).max(120), projectId: z.string().nullish(), supplierIds: z.array(z.string()).min(2, "Select at least two suppliers").max(12), weights: weightsZ.optional() });

function normalizeWeights(w?: Record<string, number>): Weights {
  const d = defaultWeights();
  for (const c of COMPONENTS) if (w && typeof w[c.key] === "number") d[c.key] = w[c.key];
  return d;
}

async function assertSuppliers(ctx: Ctx, ids: string[]) {
  const n = await prisma.supplier.count({ where: { id: { in: ids }, workspaceId: ctx.workspaceId } });
  if (n !== new Set(ids).size) throw notFound("One or more suppliers");
}

export async function previewComparison(ctx: Ctx, raw: { supplierIds: string[]; projectId?: string | null; weights?: Record<string, number> }) {
  if (!raw.supplierIds || raw.supplierIds.length < 2) throw badRequest("Select at least two suppliers to compare.");
  await assertSuppliers(ctx, raw.supplierIds);
  const weights = normalizeWeights(raw.weights);
  const metrics = await Promise.all([...new Set(raw.supplierIds)].map((id) => computeMetrics(id, raw.projectId)));
  return { weights, ranked: rank(metrics, weights), computedAt: new Date().toISOString(), disclaimer: DISCLAIMER, components: COMPONENTS };
}

export async function createComparison(ctx: Ctx, raw: unknown) {
  const p = createZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid comparison", p.error.flatten());
  const d = p.data;
  if (d.projectId) { const pr = await prisma.sourcingProject.findFirst({ where: { id: d.projectId, workspaceId: ctx.workspaceId }, select: { id: true } }); if (!pr) throw notFound("Project"); }
  const prev = await previewComparison(ctx, { supplierIds: d.supplierIds, projectId: d.projectId, weights: d.weights });
  const run = await runAction(ctx, { actionType: "CREATE_COMPARISON", actorType: "USER", params: { supplierIds: d.supplierIds, projectId: d.projectId ?? null }, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] }, async () =>
    prisma.supplierComparison.create({ data: { workspaceId: ctx.workspaceId, projectId: d.projectId ?? null, name: d.name, supplierIds: [...new Set(d.supplierIds)], result: { computedAt: prev.computedAt, ranked: prev.ranked } as object, weights: { create: Object.entries(prev.weights).map(([component, weight]) => ({ component, weight })) } } }));
  assertAllowed(run);
  await audit(ctx, "comparison.created", "SupplierComparison", run.result!.id, { suppliers: d.supplierIds.length });
  return run.result!;
}

export async function getComparison(ctx: Ctx, id: string) {
  const c = await prisma.supplierComparison.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { weights: true, project: { select: { id: true, name: true } } } });
  if (!c) throw notFound("Comparison");
  return c;
}

export async function rescoreComparison(ctx: Ctx, id: string, weightsRaw: Record<string, number>) {
  const c = await getComparison(ctx, id);
  const parsed = weightsZ.safeParse(weightsRaw);
  if (!parsed.success) throw badRequest("Invalid weights", parsed.error.flatten());
  const weights = normalizeWeights(parsed.data);
  const prev = await previewComparison(ctx, { supplierIds: c.supplierIds, projectId: c.projectId, weights });
  await prisma.$transaction([
    prisma.comparisonWeight.deleteMany({ where: { comparisonId: id } }),
    prisma.comparisonWeight.createMany({ data: Object.entries(weights).map(([component, weight]) => ({ comparisonId: id, component, weight })) }),
    prisma.supplierComparison.update({ where: { id }, data: { result: { computedAt: prev.computedAt, ranked: prev.ranked } as object } }),
  ]);
  await audit(ctx, "comparison.weights_saved", "SupplierComparison", id, { weights });
  return getComparison(ctx, id);
}

export async function listComparisons(ctx: Ctx) {
  return prisma.supplierComparison.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { updatedAt: "desc" }, take: 50, include: { project: { select: { id: true, name: true } } } });
}
export async function deleteComparison(ctx: Ctx, id: string) {
  await getComparison(ctx, id);
  await prisma.supplierComparison.delete({ where: { id } });
  await audit(ctx, "comparison.deleted", "SupplierComparison", id);
}

export function weightsOf(c: { weights: { component: string; weight: number }[] }): Weights {
  return normalizeWeights(Object.fromEntries(c.weights.map((w) => [w.component, w.weight])));
}

const csvEsc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function toCsv(ranked: RankedSupplier[], weights: Weights): string {
  const head = ["Rank", "Supplier", "Total score", "Weight coverage %", ...COMPONENTS.map((c) => `${c.label} (weight ${weights[c.key]})`), ...COMPONENTS.map((c) => `${c.label} — explanation`)];
  const rows = ranked.map((r) => [r.rank, r.name, r.total ?? "N/A", r.coverage, ...COMPONENTS.map((c) => r.components[c.key].score ?? "N/A"), ...COMPONENTS.map((c) => r.components[c.key].detail)]);
  return [head, ...rows, [], [DISCLAIMER]].map((r) => r.map(csvEsc).join(",")).join("\r\n");
}

export async function toPdf(title: string, projectName: string | null, ranked: RankedSupplier[], weights: Weights): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(18).text(`PROXY — Supplier comparison`).moveDown(0.3);
    doc.fontSize(11).fillColor("#444").text(`${title}${projectName ? ` · Project: ${projectName}` : ""}`).text(`Generated ${new Date().toISOString()}`).moveDown();
    doc.fillColor("#000").fontSize(12).text("Ranking weights").moveDown(0.2);
    doc.fontSize(9).text(COMPONENTS.map((c) => `${c.label}: ${weights[c.key]}`).join("  ·  ")).moveDown();
    for (const r of ranked) {
      if (doc.y > 650) doc.addPage();
      doc.fontSize(13).fillColor("#000").text(`#${r.rank}  ${r.name} — ${r.total ?? "N/A"} / 100`, { continued: false });
      doc.fontSize(8).fillColor("#666").text(`Weight coverage ${r.coverage}% (components without data are excluded)`).moveDown(0.2);
      for (const c of COMPONENTS) doc.fontSize(8.5).fillColor("#000").text(`• ${c.label}: ${r.components[c.key].score ?? "N/A"} — ${r.components[c.key].detail}`, { width: 515 });
      doc.moveDown(0.8);
    }
    doc.fontSize(8).fillColor("#a00").text(DISCLAIMER, { width: 515 });
    doc.end();
  });
}

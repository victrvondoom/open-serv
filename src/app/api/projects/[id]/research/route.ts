import { prisma } from "@/lib/db";
import { body, handle, json } from "@/lib/api/route";
import { getProject } from "@/lib/projects";
import { startResearch } from "@/lib/research/pipeline";

export const GET = handle(async (_r, ctx, p) => {
  await getProject(ctx, p.id);
  return { items: await prisma.researchJob.findMany({ where: { projectId: p.id, workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" }, take: 25 }) };
});
export const POST = handle(async (req, ctx, p) => {
  const b = await body<{ includeReviews?: boolean; includeNews?: boolean; pages?: number; maxSuppliers?: number }>(req);
  return json(await startResearch(ctx, p.id, { ...(b.includeReviews !== undefined ? { includeReviews: !!b.includeReviews } : {}), ...(b.includeNews !== undefined ? { includeNews: !!b.includeNews } : {}), ...(b.pages ? { pages: Math.min(3, Math.max(1, Number(b.pages))) } : {}), ...(b.maxSuppliers ? { maxSuppliers: Math.min(50, Math.max(1, Number(b.maxSuppliers))) } : {}) }), 201);
});

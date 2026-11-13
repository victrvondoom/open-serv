import { prisma } from "@/lib/db";
import { handle } from "@/lib/api/route";
import { notFound } from "@/lib/errors";

export const GET = handle(async (_r, ctx, p) => {
  const job = await prisma.researchJob.findFirst({ where: { id: p.id, workspaceId: ctx.workspaceId }, include: { requests: { orderBy: { requestedAt: "asc" }, select: { id: true, engine: true, query: true, status: true, providerSearchId: true, resultCount: true, creditsUsed: true, cacheHit: true, error: true, requestedAt: true, durationMs: true } } } });
  if (!job) throw notFound("Research job");
  return job;
});

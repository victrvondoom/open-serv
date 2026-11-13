import { prisma } from "@/lib/db";
import { handle, json } from "@/lib/api/route";
import { loadSyntheticCorpus } from "@/lib/benchmarks/service";
export const GET = handle(async (_r, ctx) => ({ items: await prisma.benchmarkSuite.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { scenarios: true, runs: true } } }, orderBy: { createdAt: "asc" } }) }));
export const POST = handle(async (_r, ctx) => json(await loadSyntheticCorpus(ctx), 201));

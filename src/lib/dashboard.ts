import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { metricsForRun } from "@/lib/benchmarks/runner";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Every figure is computed from persisted rows at request time. */
export async function getDashboard(ctx: Ctx) {
  const w = ctx.workspaceId;
  const since = new Date(Date.now() - 29 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const [projects, suppliers, running, completed, failedJobs, incomplete, conflicting, openFindings, allFindings, pendingRfq, rfqSent, recentActions, recentRuns, jobsHist, supHist, findHist, sevGroups, integrations, requests, credits] = await Promise.all([
    prisma.sourcingProject.count({ where: { workspaceId: w } }),
    prisma.supplier.count({ where: { workspaceId: w } }),
    prisma.researchJob.count({ where: { workspaceId: w, status: { in: ["QUEUED", "RUNNING"] } } }),
    prisma.researchJob.count({ where: { workspaceId: w, status: "COMPLETED" } }),
    prisma.researchJob.count({ where: { workspaceId: w, status: "FAILED" } }),
    prisma.supplier.count({ where: { workspaceId: w, OR: [{ phone: null }, { email: null }, { address: null }, { website: null }] } }),
    prisma.supplier.count({ where: { workspaceId: w, claims: { some: { status: "CONFLICTING" } } } }),
    prisma.securityFinding.count({ where: { workspaceId: w, reviewStatus: "PENDING" } }),
    prisma.securityFinding.count({ where: { workspaceId: w } }),
    prisma.rFQ.count({ where: { workspaceId: w, status: { in: ["DRAFT", "APPROVED"] } } }),
    prisma.rFQ.count({ where: { workspaceId: w, status: { in: ["SENT", "PARTIALLY_SENT"] } } }),
    prisma.actionProposal.findMany({ where: { workspaceId: w, simulated: false }, orderBy: { createdAt: "desc" }, take: 8, include: { executions: { orderBy: { startedAt: "desc" }, take: 1 } } }),
    prisma.benchmarkRun.findMany({ where: { workspaceId: w, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, take: 3, include: { suite: { select: { name: true } } } }),
    prisma.researchJob.findMany({ where: { workspaceId: w, createdAt: { gte: since } }, select: { createdAt: true, status: true } }),
    prisma.supplier.findMany({ where: { workspaceId: w, createdAt: { gte: since } }, select: { createdAt: true } }),
    prisma.securityFinding.findMany({ where: { workspaceId: w, createdAt: { gte: since } }, select: { createdAt: true, severity: true } }),
    prisma.securityFinding.groupBy({ by: ["severity"], where: { workspaceId: w }, _count: true }),
    prisma.integrationStatus.findMany({ where: { workspaceId: w } }),
    prisma.searchRequest.count({ where: { workspaceId: w } }),
    prisma.searchRequest.aggregate({ where: { workspaceId: w }, _sum: { creditsUsed: true } }),
  ]);
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(day(new Date(Date.now() - i * 86400_000)));
  const series = days.map((d) => ({ date: d, jobs: jobsHist.filter((x) => day(x.createdAt) === d).length, suppliers: supHist.filter((x) => day(x.createdAt) === d).length, findings: findHist.filter((x) => day(x.createdAt) === d).length }));
  const runs = await Promise.all(recentRuns.map(async (r) => ({ id: r.id, name: r.name, suite: r.suite.name, createdAt: r.createdAt, split: r.split, datasetVersion: r.datasetVersion, metrics: await metricsForRun(r.id) })));
  return {
    totals: { projects, suppliers, runningJobs: running, completedJobs: completed, failedJobs, incompleteEvidence: incomplete, conflictingSuppliers: conflicting, openFindings, allFindings, pendingRfq, rfqSent, searchRequests: requests, creditsUsed: credits._sum.creditsUsed ?? 0 },
    series, severity: sevGroups.map((g) => ({ severity: g.severity, count: g._count })),
    recentActions: recentActions.map((a) => ({ id: a.id, actionType: a.actionType, actorType: a.actorType, decision: a.decision, status: a.executions[0]?.status ?? "NOT_EXECUTED", at: a.createdAt })),
    recentRuns: runs, integrations: integrations.map((i) => ({ provider: i.provider, status: i.status, message: i.message, checkedAt: i.checkedAt, creditsRemaining: i.creditsRemaining })),
  };
}

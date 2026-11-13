import { prisma } from "@/lib/db";
import { handle, query } from "@/lib/api/route";
import { verifyReceiptChain } from "@/lib/actions/controller";

export const GET = handle(async (req, ctx) => {
  const q = query(req);
  const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Number(q.pageSize) || 25);
  const where = { workspaceId: ctx.workspaceId, ...(q.simulated === "yes" ? {} : { simulated: false }), ...(q.decision ? { decision: q.decision as never } : {}), ...(q.actionType ? { actionType: q.actionType as never } : {}) };
  const [items, total, chain] = await Promise.all([prisma.actionProposal.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { executions: { orderBy: { startedAt: "desc" } }, receipts: { orderBy: { seq: "asc" }, select: { seq: true, receiptHash: true, createdAt: true } } } }), prisma.actionProposal.count({ where }), verifyReceiptChain(ctx.workspaceId)]);
  return { items, total, page, pageSize, receiptChain: chain };
});

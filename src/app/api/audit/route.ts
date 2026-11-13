import { prisma } from "@/lib/db";
import { handle, query } from "@/lib/api/route";
export const GET = handle(async (req, ctx) => {
  const q = query(req);
  const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Number(q.pageSize) || 50);
  const where = { workspaceId: ctx.workspaceId, ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.action ? { action: { contains: q.action } } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
  const [items, total] = await Promise.all([prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.auditEvent.count({ where })]);
  return { items, total, page, pageSize };
});

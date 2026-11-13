import { body, handle, json, query } from "@/lib/api/route";
import { createRfq, listRfqs } from "@/lib/rfq/service";
export const GET = handle(async (req, ctx) => { const q = query(req); return listRfqs(ctx, { projectId: q.projectId, status: q.status, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 }); });
export const POST = handle(async (req, ctx) => json(await createRfq(ctx, await body(req)), 201));

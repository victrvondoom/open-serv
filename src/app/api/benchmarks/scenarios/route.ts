import { body, handle, json, query } from "@/lib/api/route";
import { createScenario, listScenarios } from "@/lib/benchmarks/service";
export const GET = handle(async (req, ctx) => { const q = query(req); return listScenarios(ctx, { suiteId: q.suiteId, split: q.split, category: q.category, q: q.q, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 25 }); });
export const POST = handle(async (req, ctx) => json(await createScenario(ctx, await body(req)), 201));

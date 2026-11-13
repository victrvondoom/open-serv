import { body, handle, json } from "@/lib/api/route";
import { deleteComparison, getComparison, rescoreComparison } from "@/lib/compare/service";
export const GET = handle(async (_r, ctx, p) => getComparison(ctx, p.id));
export const PATCH = handle(async (req, ctx, p) => { const b = await body<{ weights?: Record<string, number> }>(req); return rescoreComparison(ctx, p.id, b.weights ?? {}); });
export const DELETE = handle(async (_r, ctx, p) => { await deleteComparison(ctx, p.id); return json({ ok: true }); });

import { body, handle, json } from "@/lib/api/route";
import { deleteScenario, getScenario, updateScenario } from "@/lib/benchmarks/service";
export const GET = handle(async (_r, ctx, p) => getScenario(ctx, p.id));
export const PATCH = handle(async (req, ctx, p) => updateScenario(ctx, p.id, await body(req)));
export const DELETE = handle(async (_r, ctx, p) => { await deleteScenario(ctx, p.id); return json({ ok: true }); });

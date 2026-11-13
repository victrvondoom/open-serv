import { body, handle, json } from "@/lib/api/route";
import { deleteRfq, getRfq, updateRfq } from "@/lib/rfq/service";
export const GET = handle(async (_r, ctx, p) => getRfq(ctx, p.id));
export const PATCH = handle(async (req, ctx, p) => updateRfq(ctx, p.id, await body(req)));
export const DELETE = handle(async (_r, ctx, p) => { await deleteRfq(ctx, p.id); return json({ ok: true }); });

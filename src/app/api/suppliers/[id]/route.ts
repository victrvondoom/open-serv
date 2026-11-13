import { body, handle, json } from "@/lib/api/route";
import { deleteSupplier, getSupplierDetail, updateSupplier } from "@/lib/suppliers";

export const GET = handle(async (_r, ctx, p) => getSupplierDetail(ctx, p.id));
export const PATCH = handle(async (req, ctx, p) => updateSupplier(ctx, p.id, await body(req)));
export const DELETE = handle(async (_r, ctx, p) => { await deleteSupplier(ctx, p.id); return json({ ok: true }); });

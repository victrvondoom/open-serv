import { body, handle, json, query } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { addSupplierToProject, removeSupplierFromProject } from "@/lib/suppliers";

export const POST = handle(async (req, ctx, p) => { const b = await body<{ projectId?: string }>(req); if (!b.projectId) throw badRequest("projectId is required"); return json(await addSupplierToProject(ctx, p.id, b.projectId), 201); });
export const DELETE = handle(async (req, ctx, p) => { const q = query(req); if (!q.projectId) throw badRequest("projectId is required"); await removeSupplierFromProject(ctx, p.id, q.projectId); return json({ ok: true }); });

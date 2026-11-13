import { body, handle, json } from "@/lib/api/route";
import { deleteProject, getProject, updateProject } from "@/lib/projects";

export const GET = handle(async (_r, ctx, p) => getProject(ctx, p.id));
export const PATCH = handle(async (req, ctx, p) => updateProject(ctx, p.id, await body(req)));
export const DELETE = handle(async (_r, ctx, p) => { await deleteProject(ctx, p.id); return json({ ok: true }); });

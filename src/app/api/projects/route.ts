import { body, handle, json, query } from "@/lib/api/route";
import { createProject, listProjects } from "@/lib/projects";

export const GET = handle(async (req, ctx) => { const q = query(req); return listProjects(ctx, { q: q.q, status: q.status, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 20 }); });
export const POST = handle(async (req, ctx) => json(await createProject(ctx, await body(req)), 201));

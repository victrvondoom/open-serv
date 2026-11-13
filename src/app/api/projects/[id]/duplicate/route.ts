import { handle, json } from "@/lib/api/route";
import { duplicateProject } from "@/lib/projects";

export const POST = handle(async (_r, ctx, p) => json(await duplicateProject(ctx, p.id), 201));

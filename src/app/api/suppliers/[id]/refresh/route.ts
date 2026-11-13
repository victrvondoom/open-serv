import { body, handle, json } from "@/lib/api/route";
import { refreshSupplier } from "@/lib/research/pipeline";
export const POST = handle(async (req, ctx, p) => { const b = await body<{ projectId?: string }>(req); return json(await refreshSupplier(ctx, p.id, b.projectId), 201); });

import { body, handle, json } from "@/lib/api/route";
import { createRun, listRuns } from "@/lib/benchmarks/service";
import { rateLimit } from "@/lib/ratelimit";
export const GET = handle(async (_r, ctx) => ({ items: await listRuns(ctx) }));
export const POST = handle(async (req, ctx) => { await rateLimit(`benchmark:${ctx.workspaceId}`, 20, 3600); return json(await createRun(ctx, await body(req)), 201); });

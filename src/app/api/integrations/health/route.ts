import { handle } from "@/lib/api/route";
import { readCachedHealth, runHealthChecks } from "@/lib/providers/health";
import { rateLimit } from "@/lib/ratelimit";
export const GET = handle(async (_r, ctx) => ({ items: await readCachedHealth(ctx.workspaceId) }));
export const POST = handle(async (_r, ctx) => { await rateLimit(`health:${ctx.workspaceId}`, 20, 60); return { items: await runHealthChecks(ctx.workspaceId) }; });

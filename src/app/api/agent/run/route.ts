import { body, handle } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { runResearchAgent } from "@/lib/agent/research-agent";
import { rateLimit } from "@/lib/ratelimit";
export const POST = handle(async (req, ctx) => { const b = await body<{ supplierId?: string; projectId?: string }>(req); if (!b.supplierId) throw badRequest("supplierId is required"); await rateLimit(`agent:${ctx.workspaceId}`, 30, 60); return runResearchAgent(ctx, { supplierId: b.supplierId, projectId: b.projectId }); });

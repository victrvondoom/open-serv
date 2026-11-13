import { body, handle, json } from "@/lib/api/route";
import { reviewFinding } from "@/lib/security/service";
export const POST = handle(async (req, ctx, p) => json(await reviewFinding(ctx, p.id, await body(req)), 201));

import { body, handle, json } from "@/lib/api/route";
import { ingestSource } from "@/lib/security/service";
export const POST = handle(async (req, ctx) => json(await ingestSource(ctx, await body(req)), 201));

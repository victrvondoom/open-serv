import { handle, json } from "@/lib/api/route";
import { duplicateRfq } from "@/lib/rfq/service";
export const POST = handle(async (_r, ctx, p) => json(await duplicateRfq(ctx, p.id), 201));

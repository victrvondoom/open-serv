import { body, handle } from "@/lib/api/route";
import { approveRfq } from "@/lib/rfq/service";
export const POST = handle(async (req, ctx, p) => approveRfq(ctx, p.id, await body(req)));

import { handle } from "@/lib/api/route";
import { getRfq, refreshVerifications } from "@/lib/rfq/service";
export const POST = handle(async (_r, ctx, p) => { await getRfq(ctx, p.id); await refreshVerifications(p.id); return getRfq(ctx, p.id); });

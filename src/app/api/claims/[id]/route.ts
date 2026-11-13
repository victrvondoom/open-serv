import { body, handle } from "@/lib/api/route";
import { reviewClaim } from "@/lib/evidence/service";
export const PATCH = handle(async (req, ctx, p) => reviewClaim(ctx, p.id, await body(req)));

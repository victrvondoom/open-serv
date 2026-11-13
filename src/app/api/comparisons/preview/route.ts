import { body, handle } from "@/lib/api/route";
import { previewComparison } from "@/lib/compare/service";
export const POST = handle(async (req, ctx) => previewComparison(ctx, await body(req)));

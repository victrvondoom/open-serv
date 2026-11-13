import { body, handle, json } from "@/lib/api/route";
import { createComparison, listComparisons } from "@/lib/compare/service";
export const GET = handle(async (_r, ctx) => ({ items: await listComparisons(ctx) }));
export const POST = handle(async (req, ctx) => json(await createComparison(ctx, await body(req)), 201));

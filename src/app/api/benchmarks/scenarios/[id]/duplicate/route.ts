import { handle, json } from "@/lib/api/route";
import { duplicateScenario } from "@/lib/benchmarks/service";
export const POST = handle(async (_r, ctx, p) => json(await duplicateScenario(ctx, p.id), 201));

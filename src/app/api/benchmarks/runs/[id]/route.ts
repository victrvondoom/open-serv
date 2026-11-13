import { handle } from "@/lib/api/route";
import { getRun } from "@/lib/benchmarks/service";
export const GET = handle(async (_r, ctx, p) => getRun(ctx, p.id));

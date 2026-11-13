import { handle } from "@/lib/api/route";
import { stopJob } from "@/lib/research/pipeline";
export const POST = handle(async (_r, ctx, p) => stopJob(ctx, p.id));

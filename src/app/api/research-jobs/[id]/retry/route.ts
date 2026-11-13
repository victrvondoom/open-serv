import { handle, json } from "@/lib/api/route";
import { retryJob } from "@/lib/research/pipeline";
export const POST = handle(async (_r, ctx, p) => json(await retryJob(ctx, p.id), 201));

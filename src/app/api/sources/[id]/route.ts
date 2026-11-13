import { handle } from "@/lib/api/route";
import { getSource } from "@/lib/evidence/service";
export const GET = handle(async (_r, ctx, p) => getSource(ctx, p.id));

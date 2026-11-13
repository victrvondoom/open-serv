import { handle } from "@/lib/api/route";
import { getFinding } from "@/lib/security/service";
export const GET = handle(async (_r, ctx, p) => getFinding(ctx, p.id));

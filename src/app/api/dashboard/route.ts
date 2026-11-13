import { handle } from "@/lib/api/route";
import { getDashboard } from "@/lib/dashboard";
export const GET = handle(async (_r, ctx) => getDashboard(ctx));

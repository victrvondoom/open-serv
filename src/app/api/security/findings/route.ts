import { handle, query } from "@/lib/api/route";
import { listFindings } from "@/lib/security/service";
export const GET = handle(async (req, ctx) => listFindings(ctx, query(req)));

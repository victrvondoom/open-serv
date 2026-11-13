import { handle, query } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { exportEml } from "@/lib/rfq/service";
export const GET = handle(async (req, ctx, p) => { const rid = query(req).recipientId; if (!rid) throw badRequest("recipientId is required"); const e = await exportEml(ctx, p.id, rid); return new Response(e.content, { headers: { "content-type": "message/rfc822", "content-disposition": `attachment; filename="${e.filename}"` } }); });

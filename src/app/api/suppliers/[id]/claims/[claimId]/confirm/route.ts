import { body, handle, json } from "@/lib/api/route";
import { confirmClaim } from "@/lib/suppliers";
export const POST = handle(async (req, ctx, p) => { const b = await body<{ confirm?: boolean }>(req); await confirmClaim(ctx, p.id, p.claimId, b.confirm !== false); return json({ ok: true }); });

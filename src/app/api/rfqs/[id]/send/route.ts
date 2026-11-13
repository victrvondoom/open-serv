import { body, handle } from "@/lib/api/route";
import { sendRfq } from "@/lib/rfq/service";
export const POST = handle(async (req, ctx, p) => { const b = await body<{ recipientIds?: string[]; retry?: boolean }>(req); return sendRfq(ctx, p.id, { recipientIds: b.recipientIds, retry: !!b.retry }); });

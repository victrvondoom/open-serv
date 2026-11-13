import { body, handle } from "@/lib/api/route";
import { approveProposal } from "@/lib/actions/controller";
import { executeStoredProposal } from "@/lib/actions/exec";
export const POST = handle(async (req, ctx, p) => {
  const b = await body<{ approve?: boolean }>(req);
  const prop = await approveProposal(ctx, p.id, b.approve !== false);
  if (prop.approvalStatus !== "APPROVED") return { proposal: prop };
  try { const r = await executeStoredProposal(ctx, p.id); return { proposal: prop, execution: r.execution }; } catch (e) { return { proposal: prop, execution: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } }; }
});

import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { ApiError, notFound } from "@/lib/errors";
import { executeProposal } from "@/lib/actions/controller";
import { createRfq } from "@/lib/rfq/service";

/** Executors for the (few) actions an agent proposal may carry out once policy allows or a human approves. */
export async function executeStoredProposal(ctx: Ctx, proposalId: string) {
  const p = await prisma.actionProposal.findFirst({ where: { id: proposalId, workspaceId: ctx.workspaceId } });
  if (!p) throw notFound("Action proposal");
  const params = p.params as Record<string, unknown>;
  return executeProposal(ctx, p.id, async () => {
    switch (p.actionType) {
      case "UPDATE_SUPPLIER_NOTES": {
        const s = await prisma.supplier.findFirst({ where: { id: String(params.supplierId), workspaceId: ctx.workspaceId } });
        if (!s) throw notFound("Supplier");
        const lines = Array.isArray(params.appended) ? (params.appended as string[]) : [String(params.text ?? "")];
        await prisma.supplier.update({ where: { id: s.id }, data: { notes: `${s.notes ? `${s.notes}\n\n` : ""}[${p.actorType.toLowerCase()}] ${lines.map((l) => `- ${l}`).join("\n")}` } });
        return { supplierId: s.id };
      }
      case "CREATE_RFQ_DRAFT": {
        const r = await createRfq(ctx, { projectId: params.projectId, recipients: [{ supplierId: params.supplierId, email: params.to }] });
        return { rfqId: r.rfq.id };
      }
      default:
        throw new ApiError(400, "not_executable", `Action ${p.actionType} cannot be executed through this endpoint.`);
    }
  });
}

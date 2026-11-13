import { z } from "zod";
import { body, handle, json } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { proposeAction } from "@/lib/actions/controller";
import { executeStoredProposal } from "@/lib/actions/exec";

const zz = z.object({
  actionType: z.enum(["CREATE_SUPPLIER_RECORD", "UPDATE_SUPPLIER_NOTES", "CREATE_COMPARISON", "CREATE_RFQ_DRAFT", "EXPORT_RFQ", "SEND_RFQ_EMAIL", "MODIFY_RFQ_RECIPIENT", "MODIFY_PROJECT_REQUIREMENTS", "FETCH_URL", "ACCESS_SECRET", "FINANCIAL_ACTION"]),
  params: z.record(z.string(), z.unknown()).default({}), rfqId: z.string().optional(),
  sourceRefs: z.array(z.object({ sourceId: z.string(), passageId: z.string().optional(), kind: z.enum(["USER", "SYSTEM", "THIRD_PARTY", "MODEL"]), url: z.string().optional(), contentHash: z.string().optional() })).default([]),
});

/**
 * Entry point for an agent (or MCP client). The caller is ALWAYS treated as an AGENT: it can never self-approve,
 * and the policy engine — not the caller — decides. Status: 201 executed, 202 approval required, 403 blocked/quarantined.
 */
export const POST = handle(async (req, ctx) => {
  const p = zz.safeParse(await body(req));
  if (!p.success) throw badRequest("Invalid proposal", p.error.flatten());
  let policyContext;
  if (p.data.rfqId) {
    const { prisma } = await import("@/lib/db");
    const rfq = await prisma.rFQ.findFirst({ where: { id: p.data.rfqId, workspaceId: ctx.workspaceId }, include: { recipients: true } });
    policyContext = { rfqRecipients: rfq?.recipients.map((r) => r.email) ?? [] };
  }
  const { proposal, policy } = await proposeAction(ctx, { actionType: p.data.actionType, actorType: "AGENT", actorId: "external-agent", params: p.data.params, sourceRefs: p.data.sourceRefs, rfqId: p.data.rfqId, policyContext });
  const base = { proposalId: proposal.id, decision: policy.decision, reasons: policy.reasons, approvalStatus: proposal.approvalStatus };
  if (policy.decision === "ALLOW") {
    try { const { execution } = await executeStoredProposal(ctx, proposal.id); return json({ ...base, execution }, 201); }
    catch (e) { const { execution } = { execution: { status: "FAILED", error: e instanceof Error ? e.message : String(e) } }; return json({ ...base, execution }, 201); }
  }
  if (policy.decision === "REQUIRE_APPROVAL") { await import("@/lib/actions/controller").then((m) => m.executeProposal(ctx, proposal.id, async () => ({}))); return json(base, 202); }
  await import("@/lib/actions/controller").then((m) => m.executeProposal(ctx, proposal.id, async () => ({}))); // records NOT_EXECUTED + receipt (fail closed)
  return json({ error: { code: policy.decision === "QUARANTINE" ? "action_quarantined" : "action_blocked", message: policy.reasons.map((r) => r.message).join(" "), details: base } }, 403);
});

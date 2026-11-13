import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { notFound } from "@/lib/errors";
import { runAction, type ProposeInput } from "@/lib/actions/controller";
import type { SourceRef } from "@/lib/actions/policy";
import { createRfq } from "@/lib/rfq/service";

export interface AgentReport {
  mode: "deterministic";
  sources: { id: string; url: string; sourceType: string; trust: "UNTRUSTED_THIRD_PARTY"; quarantined: boolean; findingCategories: string[] }[];
  proposals: { actionType: string; decision: string; reasons: string[]; executionStatus: string; proposalId: string }[];
  note: string;
}

/**
 * Research agent. Retrieved content is labelled UNTRUSTED_THIRD_PARTY; its only outputs are action *proposals*, each carrying
 * the source references that contributed. Every proposal goes through the deterministic action controller — the agent cannot
 * execute anything itself, cannot change recipients/requirements, and never sends email.
 */
export async function runResearchAgent(ctx: Ctx, input: { supplierId: string; projectId?: string }): Promise<AgentReport> {
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, workspaceId: ctx.workspaceId } });
  if (!supplier) throw notFound("Supplier");
  const docs = await prisma.sourceDocument.findMany({ where: { supplierId: supplier.id }, select: { id: true, url: true, sourceType: true, findings: { select: { category: true, severity: true, reviewStatus: true } } }, orderBy: { retrievedAt: "desc" }, take: 40 });
  const sources = docs.map((d) => {
    const open = d.findings.filter((f) => f.reviewStatus !== "FALSE_POSITIVE" && f.reviewStatus !== "DISMISSED");
    return { id: d.id, url: d.url, sourceType: d.sourceType, trust: "UNTRUSTED_THIRD_PARTY" as const, quarantined: open.some((f) => f.severity !== "INFO" && f.severity !== "LOW"), findingCategories: [...new Set(open.map((f) => f.category))] };
  });
  const claims = await prisma.extractedClaim.findMany({ where: { supplierId: supplier.id, reviewStatus: { not: "INCORRECT" }, claimType: { in: ["PHONE", "EMAIL", "ADDRESS"] } }, include: { evidence: { select: { documentId: true, passageId: true, document: { select: { url: true, contentHash: true } } } } } });
  const refsFor = (cl: typeof claims): SourceRef[] => cl.flatMap((c) => c.evidence.map((e) => ({ sourceId: e.documentId, passageId: e.passageId, kind: "THIRD_PARTY" as const, url: e.document.url, contentHash: e.document.contentHash })));
  const proposals: AgentReport["proposals"] = [];
  const propose = async (p: ProposeInput, exec: () => Promise<unknown>) => {
    const r = await runAction(ctx, { ...p, actorType: "AGENT", actorId: "research-agent" }, exec);
    proposals.push({ actionType: p.actionType, decision: r.decision, reasons: r.reasons.map((x) => x.message), executionStatus: r.execution.status, proposalId: r.proposal.id });
    return r;
  };

  const lines = claims.map((c) => `${c.claimType.toLowerCase()}: ${c.value} [${c.status.toLowerCase().replace(/_/g, " ")}]`);
  if (lines.length) {
    await propose({ actionType: "UPDATE_SUPPLIER_NOTES", actorType: "AGENT", params: { supplierId: supplier.id, appended: lines }, sourceRefs: refsFor(claims) }, () =>
      prisma.supplier.update({ where: { id: supplier.id }, data: { notes: `${supplier.notes ? `${supplier.notes}\n\n` : ""}[agent ${new Date().toISOString().slice(0, 10)}] Evidence summary:\n${lines.map((l) => `- ${l}`).join("\n")}` } }));
  }
  const email = claims.find((c) => c.claimType === "EMAIL" && c.status !== "CONFLICTING");
  if (input.projectId && email) {
    await propose({ actionType: "CREATE_RFQ_DRAFT", actorType: "AGENT", params: { projectId: input.projectId, supplierId: supplier.id, to: email.normalizedValue }, sourceRefs: refsFor([email]) }, () => createRfq(ctx, { projectId: input.projectId, recipients: [{ supplierId: supplier.id, email: email.normalizedValue }] }));
  }
  return { mode: "deterministic", sources, proposals, note: "Retrieved content was treated as untrusted data; flagged sources are quarantined by policy. Proposals executed only where the policy decision was ALLOW." };
}

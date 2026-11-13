import type { ActionExecution, ActionProposal, ActionType, ActorType, ApprovalStatus, PolicyDecision } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { ApiError, conflict, notFound } from "@/lib/errors";
import { canonicalJson, errMessage, sha256 } from "@/lib/util";
import { evaluatePolicy, type FlaggedSource, type PolicyContext, type PolicyReason, type PolicyResult, type SourceRef } from "./policy";
import { audit } from "@/lib/audit";

export interface ProposeInput {
  actionType: ActionType;
  actorType: ActorType;
  actorId?: string;
  params: Record<string, unknown>;
  sourceRefs?: SourceRef[];
  userConfirmed?: boolean;
  rfqId?: string | null;
  simulated?: boolean;
  /** Extra policy context (e.g. RFQ approval state) computed by the caller from the database. */
  policyContext?: Partial<PolicyContext>;
}

const RANK: Record<string, number> = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

/** Load finding status for every referenced source so the (pure) policy function can decide. */
async function flaggedFor(workspaceId: string, refs: SourceRef[]): Promise<Record<string, FlaggedSource>> {
  const ids = [...new Set(refs.map((r) => r.sourceId))];
  if (!ids.length) return {};
  const rows = await prisma.securityFinding.findMany({ where: { workspaceId, documentId: { in: ids } } });
  const out: Record<string, FlaggedSource> = {};
  for (const f of rows) {
    const dismissed = f.reviewStatus === "FALSE_POSITIVE" || f.reviewStatus === "DISMISSED";
    const cur = out[f.documentId] ?? { severity: "INFO", categories: [], deterministic: false, reviewed: true };
    if (dismissed) { out[f.documentId] = cur; continue; }
    if (RANK[f.severity] > RANK[cur.severity]) cur.severity = f.severity as FlaggedSource["severity"];
    if (!cur.categories.includes(f.category)) cur.categories.push(f.category);
    if (f.detectionMethod !== "LLM_ASSIST") cur.deterministic = true;
    if (f.reviewStatus === "PENDING") cur.reviewed = false;
    out[f.documentId] = cur;
  }
  return out;
}

async function appendReceipt(tx: Tx, workspaceId: string, proposalId: string, executionId: string | null, payload: Record<string, unknown>) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"receipts:" + workspaceId}))`;
  const last = await tx.actionReceipt.findFirst({ where: { workspaceId }, orderBy: { seq: "desc" }, select: { seq: true, receiptHash: true } });
  const seq = (last?.seq ?? 0) + 1;
  const prevHash = last?.receiptHash ?? "GENESIS";
  const full = { ...payload, proposalId, executionId, seq, at: new Date().toISOString() };
  const receiptHash = sha256(prevHash + canonicalJson(full));
  await tx.actionReceipt.create({ data: { workspaceId, proposalId, executionId, seq, prevHash, receiptHash, payload: full as object } });
}

/** Stores the proposal (always BEFORE any execution), evaluates policy and records a receipt. */
export async function proposeAction(ctx: Pick<Ctx, "workspaceId" | "userId">, input: ProposeInput): Promise<{ proposal: ActionProposal; policy: PolicyResult }> {
  const refs = input.sourceRefs ?? [];
  let policy: PolicyResult;
  try {
    const flagged = await flaggedFor(ctx.workspaceId, refs);
    const thirdIds = refs.filter((r) => r.kind === "THIRD_PARTY").map((r) => r.sourceId);
    let thirdPartyText = input.policyContext?.thirdPartyText;
    if (thirdPartyText === undefined && thirdIds.length) {
      const docs = await prisma.sourceDocument.findMany({ where: { id: { in: thirdIds }, workspaceId: ctx.workspaceId }, select: { text: true, hiddenText: true } });
      thirdPartyText = docs.map((d) => `${d.text}\n${d.hiddenText ?? ""}`).join("\n");
    }
    policy = evaluatePolicy(
      { actionType: input.actionType, actorType: input.actorType, params: input.params, sourceRefs: refs, userConfirmed: input.userConfirmed },
      { flagged, ...input.policyContext, thirdPartyText },
    );
  } catch (e) {
    policy = { decision: "BLOCK", reasons: [{ code: "POLICY_ERROR", message: `Could not evaluate policy: ${errMessage(e)}` }] };
  }
  const approvalStatus: ApprovalStatus = policy.decision === "REQUIRE_APPROVAL" ? "PENDING" : "NOT_REQUIRED";
  const proposal = await prisma.$transaction(async (tx) => {
    const p = await tx.actionProposal.create({
      data: {
        workspaceId: ctx.workspaceId, actorType: input.actorType, actorId: input.actorId ?? (input.actorType === "USER" ? ctx.userId : input.actorType.toLowerCase()), actionType: input.actionType,
        params: input.params as object, sourceRefs: refs as unknown as object, decision: policy.decision, decisionReasons: policy.reasons as unknown as object, approvalStatus, rfqId: input.rfqId ?? null, simulated: input.simulated ?? false,
      },
    });
    await appendReceipt(tx, ctx.workspaceId, p.id, null, { event: "PROPOSED", actionType: p.actionType, actorType: p.actorType, actorId: p.actorId, decision: p.decision, reasons: policy.reasons.map((r) => r.code), paramsHash: sha256(canonicalJson(input.params)), sourceRefs: refs.map((r) => ({ id: r.sourceId, kind: r.kind, hash: r.contentHash })) });
    return p;
  });
  if (!input.simulated) await audit(ctx, "action.proposed", "ActionProposal", proposal.id, { actionType: proposal.actionType, decision: proposal.decision, actorType: proposal.actorType }, { actorType: input.actorType, actorId: proposal.actorId });
  return { proposal, policy };
}

export async function approveProposal(ctx: Pick<Ctx, "workspaceId" | "userId">, proposalId: string, approve = true): Promise<ActionProposal> {
  const p = await prisma.actionProposal.findFirst({ where: { id: proposalId, workspaceId: ctx.workspaceId } });
  if (!p) throw notFound("Action proposal");
  if (p.decision !== "REQUIRE_APPROVAL") throw conflict(`A ${p.decision} decision cannot be approved. Only REQUIRE_APPROVAL proposals can be.`);
  if (p.approvalStatus !== "PENDING") throw conflict(`Proposal is already ${p.approvalStatus}.`);
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.actionProposal.update({ where: { id: p.id }, data: { approvalStatus: approve ? "APPROVED" : "REJECTED", approvedBy: ctx.userId, approvedAt: new Date() } });
    await appendReceipt(tx, ctx.workspaceId, p.id, null, { event: approve ? "APPROVED" : "REJECTED", approvedBy: ctx.userId });
    return u;
  });
  await audit(ctx, approve ? "action.approved" : "action.rejected", "ActionProposal", p.id);
  return updated;
}

/** Executes a stored proposal. The executor only runs if policy ALLOWs (or a human approved a REQUIRE_APPROVAL). Fails closed. */
export async function executeProposal<T>(ctx: Pick<Ctx, "workspaceId" | "userId">, proposalId: string, executor: () => Promise<T>): Promise<{ execution: ActionExecution; result?: T }> {
  const p = await prisma.actionProposal.findFirst({ where: { id: proposalId, workspaceId: ctx.workspaceId } });
  if (!p) throw notFound("Action proposal");
  const allowed = p.decision === "ALLOW" || (p.decision === "REQUIRE_APPROVAL" && p.approvalStatus === "APPROVED");
  if (!allowed) {
    const why = p.decision === "REQUIRE_APPROVAL" ? "approval pending" : `policy decision ${p.decision}`;
    const execution = await prisma.$transaction(async (tx) => {
      const ex = await tx.actionExecution.create({ data: { proposalId: p.id, status: "NOT_EXECUTED", error: `Not executed: ${why}`, finishedAt: new Date() } });
      await appendReceipt(tx, ctx.workspaceId, p.id, ex.id, { event: "NOT_EXECUTED", reason: why });
      return ex;
    });
    return { execution };
  }
  const started = await prisma.actionExecution.create({ data: { proposalId: p.id, status: "PENDING" } });
  try {
    const result = await executor();
    const execution = await prisma.$transaction(async (tx) => {
      const ex = await tx.actionExecution.update({ where: { id: started.id }, data: { status: "SUCCEEDED", result: (result ?? {}) as object, finishedAt: new Date() } });
      await appendReceipt(tx, ctx.workspaceId, p.id, ex.id, { event: "EXECUTED", status: "SUCCEEDED", resultHash: sha256(canonicalJson(result ?? {})) });
      return ex;
    });
    if (!p.simulated) await audit(ctx, "action.executed", "ActionProposal", p.id, { actionType: p.actionType, status: "SUCCEEDED" });
    return { execution, result };
  } catch (e) {
    const msg = errMessage(e);
    const execution = await prisma.$transaction(async (tx) => {
      const ex = await tx.actionExecution.update({ where: { id: started.id }, data: { status: "FAILED", error: msg.slice(0, 2000), finishedAt: new Date() } });
      await appendReceipt(tx, ctx.workspaceId, p.id, ex.id, { event: "EXECUTED", status: "FAILED", error: msg.slice(0, 300) });
      return ex;
    });
    if (!p.simulated) await audit(ctx, "action.failed", "ActionProposal", p.id, { actionType: p.actionType, error: msg.slice(0, 200) });
    if (e instanceof ApiError) throw e;
    return { execution };
  }
}

/** propose → (if allowed) execute. Returns the decision so callers can surface BLOCK / REQUIRE_APPROVAL / QUARANTINE. */
export async function runAction<T>(ctx: Pick<Ctx, "workspaceId" | "userId">, input: ProposeInput, executor: () => Promise<T>) {
  const { proposal, policy } = await proposeAction(ctx, input);
  if (policy.decision !== "ALLOW") {
    const { execution } = await executeProposal(ctx, proposal.id, executor); // records NOT_EXECUTED (fail closed)
    return { proposal, decision: policy.decision as PolicyDecision, reasons: policy.reasons as PolicyReason[], execution, result: undefined as T | undefined };
  }
  const { execution, result } = await executeProposal(ctx, proposal.id, executor);
  return { proposal, decision: policy.decision as PolicyDecision, reasons: policy.reasons as PolicyReason[], execution, result };
}

/** Throws a 403/202-style ApiError when the policy did not allow the action. */
export function assertAllowed(r: { decision: PolicyDecision; reasons: PolicyReason[]; proposal: ActionProposal }) {
  if (r.decision === "ALLOW") return;
  const status = r.decision === "REQUIRE_APPROVAL" ? 409 : 403;
  throw new ApiError(status, r.decision === "REQUIRE_APPROVAL" ? "approval_required" : r.decision === "QUARANTINE" ? "action_quarantined" : "action_blocked", r.reasons.map((x) => x.message).join(" "), { decision: r.decision, reasons: r.reasons, proposalId: r.proposal.id });
}

export async function verifyReceiptChain(workspaceId: string): Promise<{ ok: boolean; checked: number; brokenAtSeq?: number }> {
  const rows = await prisma.actionReceipt.findMany({ where: { workspaceId }, orderBy: { seq: "asc" } });
  let prev = "GENESIS";
  for (const r of rows) {
    const expected = sha256(prev + canonicalJson(r.payload));
    if (r.prevHash !== prev || r.receiptHash !== expected) return { ok: false, checked: rows.length, brokenAtSeq: r.seq };
    prev = r.receiptHash;
  }
  return { ok: true, checked: rows.length };
}

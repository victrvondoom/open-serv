import { z } from "zod";
import type { Prisma, RFQ, SourcingProject } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { env, isConfigured } from "@/lib/env";
import { ApiError, badRequest, conflict, notConfigured, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { assertAllowed, runAction } from "@/lib/actions/controller";
import { resendSend } from "@/lib/providers/resend";
import { rateLimit } from "@/lib/ratelimit";
import { sha256 } from "@/lib/util";
import { originOf } from "@/lib/evidence/reconcile";
import { buildEml } from "./eml";

export function generateRfqText(p: SourcingProject, senderName: string) {
  const specs = p.specifications.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
  const lines = [
    "Dear {{supplier_name}} team,", "",
    "We are evaluating suppliers for the requirement below and would be grateful to receive your quotation.", "",
    `Product / material: ${p.productName}`, `Description: ${p.description}`,
    ...(specs.length ? ["Technical specifications:", ...specs.map((s) => `  - ${s}`)] : []),
    ...(p.materialGrade ? [`Material grade: ${p.materialGrade}`] : []),
    ...(p.quantity ? [`Quantity: ${p.quantity}${p.unit ? ` ${p.unit}` : ""}`] : []),
    `Delivery location: ${p.deliveryLocation || [p.city, p.state, p.country].filter(Boolean).join(", ")}`,
    ...(p.requiredCertifications.length ? [`Required certifications: ${p.requiredCertifications.join(", ")}`] : []),
    ...(p.additionalRequirements ? [`Additional requirements: ${p.additionalRequirements}`] : []),
    "", "Please include in your quotation: unit price and currency, minimum order quantity, lead time, payment terms, quotation validity, applicable test certificates, and delivery terms. If you cannot meet any of the requirements above, please say so explicitly.", "",
    "Thank you.", "", "Regards,", senderName,
  ];
  return { subject: `Request for Quotation — ${p.productName}${p.quantity ? ` (${p.quantity}${p.unit ? ` ${p.unit}` : ""})` : ""}`, body: lines.join("\n") };
}

export const personalize = (body: string, supplierName: string) => body.replace(/\{\{\s*supplier_name\s*\}\}/g, supplierName);
export const contentHash = (subject: string, body: string) => sha256(`${subject}\u0000${body}`);

export interface RecipientVerification {
  status: "MANUALLY_CONFIRMED" | "CORROBORATED" | "UNCORROBORATED" | "CONFLICTING" | "INSUFFICIENT_EVIDENCE" | "UNSUPPORTED";
  needsManualConfirmation: boolean;
  warnings: string[];
  evidence: { documentId: string; url: string; sourceType: string; retrievedAt: string; origin: string }[];
}

/** Checks a recipient address against collected evidence. Weak/unsupported addresses require explicit manual confirmation. */
export async function verifyRecipient(supplierId: string, emailRaw: string): Promise<RecipientVerification> {
  const email = emailRaw.trim().toLowerCase();
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId }, select: { domain: true } });
  const claim = await prisma.extractedClaim.findFirst({ where: { supplierId, claimType: "EMAIL", normalizedValue: email, reviewStatus: { not: "INCORRECT" } }, include: { evidence: { include: { document: { select: { id: true, url: true, sourceType: true, retrievedAt: true, domain: true } } } } } });
  const warnings: string[] = [];
  const suspicious = await prisma.securityFinding.findMany({ where: { supplierId, reviewStatus: { notIn: ["FALSE_POSITIVE", "DISMISSED"] }, OR: [{ matchedText: { contains: email, mode: "insensitive" } }, { excerpt: { contains: email, mode: "insensitive" } }] }, select: { id: true, category: true } });
  const openFindings = await prisma.securityFinding.count({ where: { supplierId, reviewStatus: "PENDING", severity: { in: ["MEDIUM", "HIGH", "CRITICAL"] } } });
  if (openFindings) warnings.push(`${openFindings} unreviewed security finding(s) exist for this supplier. Review them in Security before sending.`);
  if (suspicious.length) warnings.push(`This address appears inside a passage flagged as ${[...new Set(suspicious.map((s) => s.category))].join(", ")}. Do not trust it without independent verification.`);
  if (!claim) {
    warnings.unshift("This address is not supported by any collected evidence (it was typed manually or comes from no source).");
    return { status: "UNSUPPORTED", needsManualConfirmation: true, warnings, evidence: [] };
  }
  const ev = claim.evidence.map((e) => ({ documentId: e.document.id, url: e.document.url, sourceType: e.document.sourceType, retrievedAt: e.document.retrievedAt.toISOString(), origin: originOf(e.document, supplier.domain).origin }));
  const origins = new Set(ev.map((e) => e.origin));
  const strong = [...origins].some((o) => o === "OFFICIAL_SITE" || o === "MAPS" || o === "MANUAL");
  let needs = false;
  if (claim.status === "MANUALLY_CONFIRMED") return { status: "MANUALLY_CONFIRMED", needsManualConfirmation: suspicious.length > 0, warnings, evidence: ev };
  if (!strong) { needs = true; warnings.unshift(`Supported only by ${[...origins].map((o) => o.toLowerCase().replace(/_/g, " ")).join(", ")} — an uncorroborated source. Manual confirmation is required.`); }
  if (claim.status === "CONFLICTING") { needs = true; warnings.unshift(`Conflicting evidence: ${claim.statusReason ?? "sources disagree about the supplier's email."}`); }
  if (claim.status === "UNCORROBORATED" && strong) warnings.push("Single source only (no independent corroboration).");
  if (suspicious.length) needs = true;
  return { status: claim.status as RecipientVerification["status"], needsManualConfirmation: needs, warnings, evidence: ev };
}

const emailZ = z.string().trim().toLowerCase().email();
const createZ = z.object({
  projectId: z.string(), subject: z.string().trim().min(3).max(300).optional(), body: z.string().trim().min(20).max(20000).optional(),
  recipients: z.array(z.object({ supplierId: z.string(), email: emailZ.optional() })).min(1, "Select at least one supplier").max(25),
});

async function bestEmail(supplierId: string): Promise<string | null> {
  const rank = { MANUALLY_CONFIRMED: 5, CORROBORATED: 4, UNCORROBORATED: 3, CONFLICTING: 2, INSUFFICIENT_EVIDENCE: 1 } as Record<string, number>;
  const claims = await prisma.extractedClaim.findMany({ where: { supplierId, claimType: "EMAIL", reviewStatus: { not: "INCORRECT" } } });
  return claims.sort((a, b) => (rank[b.status] ?? 0) - (rank[a.status] ?? 0))[0]?.normalizedValue ?? null;
}

export async function createRfq(ctx: Ctx, raw: unknown) {
  const p = createZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid RFQ", p.error.flatten());
  const project = await prisma.sourcingProject.findFirst({ where: { id: p.data.projectId, workspaceId: ctx.workspaceId } });
  if (!project) throw notFound("Project");
  const user = await prisma.user.findUnique({ where: { id: ctx.userId } });
  const gen = generateRfqText(project, user?.name ?? "Procurement");
  const recips: { supplierId: string; email: string }[] = [];
  const missing: string[] = [];
  for (const r of p.data.recipients) {
    const s = await prisma.supplier.findFirst({ where: { id: r.supplierId, workspaceId: ctx.workspaceId }, select: { id: true, name: true } });
    if (!s) throw notFound("Supplier");
    const email = r.email ?? (await bestEmail(r.supplierId));
    if (!email) { missing.push(s.name); continue; }
    recips.push({ supplierId: r.supplierId, email });
  }
  if (!recips.length) throw badRequest(`No email address is available for the selected supplier(s) (${missing.join(", ")}). Enter a recipient manually (it will require manual confirmation) or research the supplier again.`);
  const run = await runAction(ctx, { actionType: "CREATE_RFQ_DRAFT", actorType: "USER", params: { projectId: project.id, suppliers: recips.length }, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] }, async () =>
    prisma.rFQ.create({ data: { workspaceId: ctx.workspaceId, projectId: project.id, subject: p.data.subject ?? gen.subject, body: p.data.body ?? gen.body, createdBy: ctx.userId, recipients: { create: recips.map((r) => ({ supplierId: r.supplierId, email: r.email })) } } }));
  assertAllowed(run);
  await refreshVerifications(run.result!.id);
  await audit(ctx, "rfq.created", "RFQ", run.result!.id, { recipients: recips.length, skippedNoEmail: missing });
  return { rfq: run.result!, skippedNoEmail: missing };
}

export async function refreshVerifications(rfqId: string) {
  const rs = await prisma.rFQRecipient.findMany({ where: { rfqId } });
  for (const r of rs) await prisma.rFQRecipient.update({ where: { id: r.id }, data: { verification: (await verifyRecipient(r.supplierId, r.email)) as unknown as object } });
}

export async function listRfqs(ctx: Ctx, opts: { projectId?: string; status?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page ?? 1), pageSize = Math.min(100, opts.pageSize ?? 20);
  const where: Prisma.RFQWhereInput = { workspaceId: ctx.workspaceId, ...(opts.projectId ? { projectId: opts.projectId } : {}), ...(opts.status ? { status: opts.status as never } : {}) };
  const [items, total] = await Promise.all([prisma.rFQ.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { project: { select: { id: true, name: true } }, recipients: { include: { supplier: { select: { id: true, name: true } } } } } }), prisma.rFQ.count({ where })]);
  return { items, total, page, pageSize };
}

export async function getRfq(ctx: Ctx, id: string) {
  const r = await prisma.rFQ.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { project: true, recipients: { include: { supplier: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }, approvals: { orderBy: { approvedAt: "desc" } } } });
  if (!r) throw notFound("RFQ");
  return r;
}

const patchZ = z.object({
  subject: z.string().trim().min(3).max(300).optional(), body: z.string().trim().min(20).max(20000).optional(),
  addRecipients: z.array(z.object({ supplierId: z.string(), email: emailZ })).optional(), removeRecipientIds: z.array(z.string()).optional(),
  changeRecipient: z.object({ recipientId: z.string(), email: emailZ }).optional(),
});

export async function updateRfq(ctx: Ctx, id: string, raw: unknown) {
  const p = patchZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid RFQ update", p.error.flatten());
  const rfq = await getRfq(ctx, id);
  if (rfq.status === "SENDING") throw conflict("RFQ is being sent.");
  const d = p.data;
  const contentChanged = (d.subject !== undefined && d.subject !== rfq.subject) || (d.body !== undefined && d.body !== rfq.body);
  if (d.changeRecipient) {
    const rec = rfq.recipients.find((r) => r.id === d.changeRecipient!.recipientId);
    if (!rec) throw notFound("Recipient");
    const r = await runAction(ctx, { actionType: "MODIFY_RFQ_RECIPIENT", actorType: "USER", params: { rfqId: id, recipientId: rec.id, from: rec.email, to: d.changeRecipient.email }, userConfirmed: true, rfqId: id, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] },
      () => prisma.rFQRecipient.update({ where: { id: rec.id }, data: { email: d.changeRecipient!.email, manualConfirmed: false, sendStatus: "NOT_SENT", providerMessageId: null, providerResponse: undefined, error: null, verification: (undefined as unknown) as Prisma.InputJsonValue } }));
    assertAllowed(r);
  }
  await prisma.$transaction(async (tx) => {
    if (d.addRecipients?.length) for (const a of d.addRecipients) {
      const s = await tx.supplier.findFirst({ where: { id: a.supplierId, workspaceId: ctx.workspaceId }, select: { id: true } });
      if (!s) throw notFound("Supplier");
      await tx.rFQRecipient.upsert({ where: { rfqId_email: { rfqId: id, email: a.email } }, update: {}, create: { rfqId: id, supplierId: a.supplierId, email: a.email } });
    }
    if (d.removeRecipientIds?.length) await tx.rFQRecipient.deleteMany({ where: { rfqId: id, id: { in: d.removeRecipientIds } } });
    await tx.rFQ.update({ where: { id }, data: { ...(d.subject !== undefined ? { subject: d.subject } : {}), ...(d.body !== undefined ? { body: d.body } : {}), ...(contentChanged || d.addRecipients || d.removeRecipientIds || d.changeRecipient ? { status: "DRAFT" } : {}) } });
    if (contentChanged || d.addRecipients?.length || d.removeRecipientIds?.length || d.changeRecipient) await tx.rFQRecipient.updateMany({ where: { rfqId: id, sendStatus: { not: "SENT" } }, data: { manualConfirmed: false } });
  });
  await refreshVerifications(id);
  await audit(ctx, "rfq.updated", "RFQ", id, { contentChanged, recipientsChanged: !!(d.addRecipients || d.removeRecipientIds || d.changeRecipient) });
  return getRfq(ctx, id);
}

export async function duplicateRfq(ctx: Ctx, id: string) {
  const r = await getRfq(ctx, id);
  const copy = await prisma.rFQ.create({ data: { workspaceId: ctx.workspaceId, projectId: r.projectId, subject: `${r.subject} (copy)`, body: r.body, createdBy: ctx.userId, recipients: { create: r.recipients.map((x) => ({ supplierId: x.supplierId, email: x.email })) } } });
  await refreshVerifications(copy.id);
  await audit(ctx, "rfq.duplicated", "RFQ", copy.id, { from: id });
  return copy;
}
export async function deleteRfq(ctx: Ctx, id: string) {
  await getRfq(ctx, id);
  await prisma.rFQ.delete({ where: { id } });
  await audit(ctx, "rfq.deleted", "RFQ", id);
}

export async function exportEml(ctx: Ctx, id: string, recipientId: string) {
  const rfq = await getRfq(ctx, id);
  const rec = rfq.recipients.find((r) => r.id === recipientId);
  if (!rec) throw notFound("Recipient");
  const run = await runAction(ctx, { actionType: "EXPORT_RFQ", actorType: "USER", params: { rfqId: id, recipientId, format: "eml" }, rfqId: id, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }] }, async () => buildEml({ from: env().RESEND_FROM_EMAIL, to: rec.email, subject: rfq.subject, body: personalize(rfq.body, rec.supplier.name) }));
  assertAllowed(run);
  return { filename: `RFQ-${rec.supplier.name.replace(/[^a-z0-9]+/gi, "_")}.eml`, content: run.result! };
}

const approveZ = z.object({ recipientIds: z.array(z.string()).min(1, "Select at least one recipient"), confirmManualRecipientIds: z.array(z.string()).default([]), note: z.string().max(1000).optional() });

/** Explicit human approval of the exact content + recipients. Any later edit invalidates it. */
export async function approveRfq(ctx: Ctx, id: string, raw: unknown) {
  const p = approveZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid approval", p.error.flatten());
  await refreshVerifications(id);
  const rfq = await getRfq(ctx, id);
  const chosen = rfq.recipients.filter((r) => p.data.recipientIds.includes(r.id));
  if (chosen.length !== p.data.recipientIds.length) throw notFound("Recipient");
  const needing = chosen.filter((r) => (r.verification as unknown as RecipientVerification | null)?.needsManualConfirmation && !p.data.confirmManualRecipientIds.includes(r.id));
  if (needing.length) throw new ApiError(409, "manual_confirmation_required", `These recipients are not corroborated by reliable evidence and need your explicit manual confirmation: ${needing.map((r) => r.email).join(", ")}.`, { recipientIds: needing.map((r) => r.id), warnings: needing.map((r) => ({ id: r.id, email: r.email, warnings: (r.verification as unknown as RecipientVerification).warnings })) });
  const hash = contentHash(rfq.subject, rfq.body);
  await prisma.$transaction([
    prisma.rFQApproval.create({ data: { rfqId: id, userId: ctx.userId, contentHash: hash, recipients: chosen.map((r) => ({ id: r.id, email: r.email })) as object, note: p.data.note } }),
    prisma.rFQRecipient.updateMany({ where: { id: { in: p.data.confirmManualRecipientIds.filter((x) => p.data.recipientIds.includes(x)) } }, data: { manualConfirmed: true } }),
    prisma.rFQ.update({ where: { id }, data: { status: "APPROVED" } }),
  ]);
  await audit(ctx, "rfq.approved", "RFQ", id, { recipients: chosen.map((r) => r.email), manualConfirmed: p.data.confirmManualRecipientIds.length, contentHash: hash });
  return getRfq(ctx, id);
}

/** Sends each approved recipient through the action controller, then Resend. Never sends without a matching approval. */
export async function sendRfq(ctx: Ctx, id: string, opts: { recipientIds?: string[]; retry?: boolean } = {}) {
  if (!isConfigured.resend()) throw notConfigured("Resend", "Set RESEND_API_KEY and RESEND_FROM_EMAIL (verified sender) in .env and restart. You can still export the message as .eml.");
  await rateLimit(`rfq-send:${ctx.workspaceId}`, 30, 3600);
  const rfq = await getRfq(ctx, id);
  const approval = rfq.approvals[0] ?? null;
  const hash = contentHash(rfq.subject, rfq.body);
  const approved = (approval?.recipients as unknown as { id: string; email: string }[] | undefined) ?? [];
  let targets = rfq.recipients.filter((r) => approved.some((a) => a.id === r.id && a.email === r.email));
  if (opts.recipientIds) targets = targets.filter((r) => opts.recipientIds!.includes(r.id));
  targets = targets.filter((r) => (opts.retry ? r.sendStatus === "FAILED" : r.sendStatus !== "SENT"));
  if (!approval) throw new ApiError(409, "approval_required", "Approve the recipients and content before sending.");
  if (approval.contentHash !== hash) throw new ApiError(409, "approval_required", "The subject or body changed after approval. Approve the current content again before sending.");
  if (!targets.length) throw conflict(opts.retry ? "No failed recipients to retry." : "Nothing left to send: all approved recipients were already sent.");

  await prisma.rFQ.update({ where: { id }, data: { status: "SENDING" } });
  const results: { recipientId: string; email: string; decision: string; status: string; error?: string }[] = [];
  for (const r of targets) {
    const verification = (r.verification as unknown as RecipientVerification | null) ?? (await verifyRecipient(r.supplierId, r.email));
    const run = await runAction(
      ctx,
      {
        actionType: "SEND_RFQ_EMAIL", actorType: "USER", params: { rfqId: id, recipientId: r.id, to: r.email, contentHash: hash }, rfqId: id, sourceRefs: [{ sourceId: ctx.userId, kind: "USER" }],
        policyContext: { rfqRecipients: rfq.recipients.map((x) => x.email), rfqApproval: approval ? { contentHashMatches: approval.contentHash === hash, approvedEmails: approved.map((a) => a.email) } : null, recipientNeedsManualConfirmation: verification.needsManualConfirmation, recipientManuallyConfirmed: r.manualConfirmed },
      },
      async () => {
        const res = await resendSend({ to: r.email, subject: rfq.subject, text: personalize(rfq.body, r.supplier.name), idempotencyKey: sha256(`${id}:${r.email}:${hash}:${r.attempts}`) });
        await prisma.rFQRecipient.update({ where: { id: r.id }, data: { attempts: { increment: 1 }, sendStatus: res.ok ? "SENT" : "FAILED", providerMessageId: res.id ?? null, providerResponse: { httpStatus: res.status, body: res.body } as object, error: res.ok ? null : res.error, sentAt: res.ok ? new Date() : null } });
        if (!res.ok) throw new Error(res.error ?? "Send failed");
        return { providerMessageId: res.id, httpStatus: res.status };
      },
    );
    results.push({ recipientId: r.id, email: r.email, decision: run.decision, status: run.execution.status, error: run.execution.error ?? undefined });
  }
  const all = await prisma.rFQRecipient.findMany({ where: { rfqId: id } });
  const sentN = all.filter((x) => x.sendStatus === "SENT").length;
  const status = sentN === all.length ? "SENT" : sentN > 0 ? "PARTIALLY_SENT" : results.some((x) => x.status === "FAILED") ? "FAILED" : "APPROVED";
  await prisma.rFQ.update({ where: { id }, data: { status } });
  await audit(ctx, "rfq.send_attempted", "RFQ", id, { results: results.map((x) => ({ email: x.email, decision: x.decision, status: x.status })) });
  return { rfq: await getRfq(ctx, id), results };
}

export type { RFQ };

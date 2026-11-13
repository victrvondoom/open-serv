"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Badge, Button, Field, Input, Notice, Section, Select, StatusBadge, Table, Td, Textarea, Th, fmtDate } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

interface Ver { status: string; needsManualConfirmation: boolean; warnings: string[]; evidence: { documentId: string; url: string; sourceType: string; retrievedAt: string; origin: string }[] }
interface Rec { id: string; supplierId: string; email: string; sendStatus: string; manualConfirmed: boolean; verification: Ver | null; providerMessageId: string | null; providerResponse: unknown; error: string | null; attempts: number; sentAt: string | null; supplier: { id: string; name: string } }
export interface RfqView { id: string; subject: string; body: string; status: string; project: { id: string; name: string }; recipients: Rec[]; approvals: { id: string; approvedAt: string; contentHash: string; recipients: { email: string }[] }[] }

export function RfqEditor({ rfq, resendConfigured, supplierOptions }: { rfq: RfqView; resendConfigured: boolean; supplierOptions: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [subject, setSubject] = useState(rfq.subject);
  const [body, setBody] = useState(rfq.body);
  const [preview, setPreview] = useState<Rec | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [chosen, setChosen] = useState<string[]>(rfq.recipients.filter((r) => r.sendStatus !== "SENT").map((r) => r.id));
  const [manual, setManual] = useState<string[]>([]);
  const [add, setAdd] = useState({ supplierId: supplierOptions[0]?.id ?? "", email: "" });
  const [edit, setEdit] = useState<{ id: string; email: string } | null>(null);
  const dirty = subject !== rfq.subject || body !== rfq.body;
  const done = () => router.refresh();
  const err = (e: Error) => toast.push("error", e.message);

  const save = useMutation({ mutationFn: () => api(`/api/rfqs/${rfq.id}`, { method: "PATCH", body: { subject, body } }), onSuccess: () => { toast.push("ok", "Draft saved — any previous approval is now void"); done(); }, onError: err });
  const patch = useMutation({ mutationFn: (b: object) => api(`/api/rfqs/${rfq.id}`, { method: "PATCH", body: b }), onSuccess: () => { toast.push("ok", "Recipients updated"); setEdit(null); done(); }, onError: err });
  const dup = useMutation({ mutationFn: () => api<{ id: string }>(`/api/rfqs/${rfq.id}/duplicate`, { body: {} }), onSuccess: (c) => { toast.push("ok", "Draft duplicated"); router.push(`/rfqs/${c.id}`); }, onError: err });
  const del = useMutation({ mutationFn: () => api(`/api/rfqs/${rfq.id}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "RFQ deleted"); router.push("/rfqs"); router.refresh(); }, onError: err });
  const verify = useMutation({ mutationFn: () => api(`/api/rfqs/${rfq.id}/verify`, { body: {} }), onSuccess: () => { toast.push("ok", "Recipients re-verified against evidence"); done(); }, onError: err });
  const approve = useMutation({ mutationFn: () => api(`/api/rfqs/${rfq.id}/approve`, { body: { recipientIds: chosen, confirmManualRecipientIds: manual } }), onSuccess: () => { toast.push("ok", "Approved. You can now send."); setApproveOpen(false); done(); }, onError: (e) => { if (e instanceof ApiClientError && e.code === "manual_confirmation_required") toast.push("error", e.message); else err(e); } });
  const send = useMutation({ mutationFn: (retry: boolean) => api<{ results: { email: string; status: string; error?: string; decision: string }[] }>(`/api/rfqs/${rfq.id}/send`, { body: { retry } }), onSuccess: (r) => { const ok = r.results.filter((x) => x.status === "SUCCEEDED").length; toast.push(ok === r.results.length ? "ok" : "error", `${ok}/${r.results.length} sent${r.results.some((x) => x.error) ? ` — ${r.results.find((x) => x.error)?.error}` : ""}`); done(); }, onError: err });

  const approval = rfq.approvals[0];
  const personal = (r: Rec) => body.replace(/\{\{\s*supplier_name\s*\}\}/g, r.supplier.name);
  const needsManual = rfq.recipients.filter((r) => chosen.includes(r.id) && r.verification?.needsManualConfirmation);
  const canSend = (rfq.status === "APPROVED" || rfq.status === "PARTIALLY_SENT" || rfq.status === "FAILED") && !dirty;
  const failed = rfq.recipients.some((r) => r.sendStatus === "FAILED");

  return (
    <div className="space-y-4">
      {!resendConfigured && <Notice tone="warn" title="Email sending is not configured">Set <code>RESEND_API_KEY</code> and <code>RESEND_FROM_EMAIL</code> (a sender verified in Resend) in <code>.env</code> and restart. Until then you can export each message as .eml and send it from your own mail client.</Notice>}
      <Section title="Message" description="Use {{supplier_name}} to personalise per recipient." actions={<><Button size="sm" onClick={() => dup.mutate()}>Duplicate</Button><Button size="sm" variant="danger" onClick={() => { if (window.confirm("Delete this RFQ?")) del.mutate(); }}>Delete</Button></>}>
        <div className="space-y-3"><Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field><Field label="Body"><Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[320px] font-mono text-[12px]" /></Field>
          <div className="flex items-center gap-2"><Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save draft</Button>{dirty && <span className="text-[12px] text-warn">Unsaved changes</span>}</div></div>
      </Section>

      <Section title="Recipients and verification" actions={<Button size="sm" onClick={() => verify.mutate()} disabled={verify.isPending}>Re-verify against evidence</Button>}>
        <Table><thead><tr><Th>Supplier</Th><Th>Email</Th><Th>Evidence verification</Th><Th>Delivery</Th><Th /></tr></thead>
          <tbody>{rfq.recipients.map((r) => (
            <tr key={r.id}>
              <Td><Link className="hover:underline" href={`/suppliers/${r.supplierId}`}>{r.supplier.name}</Link></Td>
              <Td>{edit?.id === r.id ? <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); patch.mutate({ changeRecipient: { recipientId: r.id, email: edit.email } }); }}><Input aria-label="New email" className="h-7 w-56" value={edit.email} onChange={(e) => setEdit({ id: r.id, email: e.target.value })} /><Button size="sm" type="submit" variant="primary">Save</Button><Button size="sm" onClick={() => setEdit(null)}>Cancel</Button></form> : <span className="break-all">{r.email}</span>}</Td>
              <Td className="max-w-md">{r.verification ? <div className="space-y-1"><div className="flex flex-wrap items-center gap-1.5"><StatusBadge status={r.verification.status} />{r.verification.needsManualConfirmation && <Badge tone="warn">manual confirmation required</Badge>}{r.manualConfirmed && <Badge tone="ok">you confirmed</Badge>}</div>{r.verification.warnings.map((w, i) => <p key={i} className="text-[12px] text-warn">⚠ {w}</p>)}{r.verification.evidence.slice(0, 2).map((e, i) => <p key={i} className="text-[11px] text-muted">{e.origin.toLowerCase().replace(/_/g, " ")} · {fmtDate(e.retrievedAt).slice(0, 10)} · <Link className="underline" href={`/evidence/sources/${e.documentId}`}>source</Link></p>)}</div> : <span className="text-muted">—</span>}</Td>
              <Td className="text-[12px]"><StatusBadge status={r.sendStatus} />{r.providerMessageId && <p className="mt-1 font-mono text-[11px] text-muted">{r.providerMessageId}</p>}{r.error && <p className="mt-1 text-danger">{r.error}</p>}{r.attempts > 0 && <p className="text-muted">{r.attempts} attempt(s){r.sentAt ? ` · sent ${fmtDate(r.sentAt)}` : ""}</p>}{r.providerResponse != null && <details><summary className="cursor-pointer text-muted">Provider response</summary><pre className="mt-1 max-w-xs overflow-auto rounded bg-bg p-1.5 text-[11px]">{JSON.stringify(r.providerResponse, null, 2)}</pre></details>}</Td>
              <Td><div className="flex flex-wrap justify-end gap-1"><Button size="sm" onClick={() => setPreview(r)}>Preview</Button><a className="inline-flex h-7 items-center rounded-md border border-border bg-surface2 px-2.5 text-[13px]" href={`/api/rfqs/${rfq.id}/export?recipientId=${r.id}`}>.eml</a><Button size="sm" onClick={() => setEdit({ id: r.id, email: r.email })}>Change</Button><Button size="sm" variant="danger" onClick={() => patch.mutate({ removeRecipientIds: [r.id] })}>Remove</Button></div></Td>
            </tr>))}</tbody></Table>
        <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); patch.mutate({ addRecipients: [add] }); setAdd({ ...add, email: "" }); }}>
          <Field label="Add recipient"><Select value={add.supplierId} onChange={(e) => setAdd({ ...add, supplierId: e.target.value })} aria-label="Supplier">{supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Email" className="min-w-64"><Input type="email" required value={add.email} onChange={(e) => setAdd({ ...add, email: e.target.value })} placeholder="name@supplier.com" /></Field><Button type="submit" disabled={!add.supplierId}>Add</Button>
        </form>
      </Section>

      <Section title="Approve and send" description="Sending requires your explicit approval of the exact recipients and content. Editing the draft voids the approval.">
        <div className="space-y-3 text-[13px]">
          <p>Status: <StatusBadge status={rfq.status} />{approval && <span className="ml-2 text-muted">last approval {fmtDate(approval.approvedAt)} for {approval.recipients.map((x) => x.email).join(", ")}</span>}</p>
          <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={dirty || rfq.recipients.length === 0} onClick={() => setApproveOpen(true)}>Review and approve…</Button>
            <Button variant="primary" disabled={!resendConfigured || !canSend || send.isPending} onClick={() => { if (window.confirm("Send this RFQ by email to the approved recipients now?")) send.mutate(false); }}>{send.isPending ? "Sending…" : "Send approved RFQ"}</Button>
            {failed && <Button disabled={!resendConfigured || send.isPending} onClick={() => send.mutate(true)}>Retry failed sends</Button>}</div>
          {dirty && <p className="text-warn">Save your edits before approving.</p>}
        </div>
      </Section>

      <Modal open={!!preview} onOpenChange={() => setPreview(null)} wide title={preview ? `Preview — ${preview.supplier.name}` : ""} description="Exactly what this recipient receives.">
        {preview && <div className="space-y-2 text-[13px]"><p><span className="text-muted">To:</span> {preview.email}</p><p><span className="text-muted">Subject:</span> {subject}</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-bg p-3 font-sans">{personal(preview)}</pre></div>}
      </Modal>
      <Modal open={approveOpen} onOpenChange={setApproveOpen} wide title="Approve recipients and content" description="Tick the recipients you approve. Addresses without reliable evidence require you to confirm them manually.">
        <div className="space-y-3 text-[13px]">
          <ul className="space-y-2">{rfq.recipients.map((r) => (
            <li key={r.id} className="rounded border border-border p-2"><label className="flex items-center gap-2"><input type="checkbox" checked={chosen.includes(r.id)} disabled={r.sendStatus === "SENT"} onChange={() => setChosen((c) => (c.includes(r.id) ? c.filter((x) => x !== r.id) : [...c, r.id]))} /><b>{r.supplier.name}</b> → {r.email} {r.sendStatus === "SENT" && <StatusBadge status="SENT" />}</label>
              {r.verification?.needsManualConfirmation && chosen.includes(r.id) && <div className="mt-1.5 rounded bg-warn/10 p-2">{r.verification.warnings.map((w, i) => <p key={i} className="text-[12px] text-warn">⚠ {w}</p>)}<label className="mt-1 flex items-center gap-2 text-[12px]"><input type="checkbox" checked={manual.includes(r.id)} onChange={() => setManual((m) => (m.includes(r.id) ? m.filter((x) => x !== r.id) : [...m, r.id]))} />I have independently verified that {r.email} is the correct address for {r.supplier.name}.</label></div>}</li>))}</ul>
          {needsManual.some((r) => !manual.includes(r.id)) && <Notice tone="warn">Confirm each flagged address, or untick that recipient.</Notice>}
          <div className="flex justify-end gap-2"><Button onClick={() => setApproveOpen(false)}>Cancel</Button><Button variant="primary" disabled={!chosen.length || approve.isPending || needsManual.some((r) => !manual.includes(r.id))} onClick={() => approve.mutate()}>Approve subject, body and {chosen.length} recipient(s)</Button></div>
        </div>
      </Modal>
    </div>
  );
}

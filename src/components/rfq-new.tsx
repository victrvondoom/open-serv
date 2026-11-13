"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

interface Sup { id: string; name: string; email: string | null }

export function NewRfq({ projects, defaultProject }: { projects: { id: string; name: string }[]; defaultProject?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(defaultProject ?? projects[0]?.id ?? "");
  const [sel, setSel] = useState<Record<string, string>>({});
  const list = useQuery({ queryKey: ["rfq-sups", projectId], enabled: open && !!projectId, queryFn: () => api<{ items: Sup[] }>(`/api/suppliers?projectId=${projectId}&pageSize=100&sort=match`).then((r) => r.items) });
  const toggle = (s: Sup) => setSel((x) => { const n = { ...x }; if (s.id in n) delete n[s.id]; else n[s.id] = s.email ?? ""; return n; });
  const create = useMutation({ mutationFn: () => api<{ rfq: { id: string }; skippedNoEmail: string[] }>("/api/rfqs", { body: { projectId, recipients: Object.entries(sel).map(([supplierId, email]) => ({ supplierId, ...(email ? { email } : {}) })) } }), onSuccess: (r) => { toast.push("ok", r.skippedNoEmail.length ? `Draft created; skipped (no email): ${r.skippedNoEmail.join(", ")}` : "RFQ draft generated from the project specification"); setOpen(false); router.push(`/rfqs/${r.rfq.id}`); }, onError: (e) => toast.push("error", e.message) });
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} disabled={projects.length === 0}>New RFQ</Button>
      <Modal open={open} onOpenChange={setOpen} wide title="New RFQ" description="The draft is generated from the project's actual specification. Nothing is sent automatically.">
        <div className="space-y-3">
          <Field label="Sourcing project"><Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setSel({}); }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <div><p className="mb-1 text-xs font-medium text-muted">Suppliers and recipient email</p>
            {list.isLoading ? <p className="text-[13px] text-muted">Loading suppliers…</p> : !list.data?.length ? <Notice tone="warn">No suppliers are saved to this project. Run research or save suppliers to the project first.</Notice> : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">{list.data.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded border border-border px-2 py-1.5 text-[13px]"><input type="checkbox" aria-label={`Select ${s.name}`} checked={s.id in sel} onChange={() => toggle(s)} /><span className="w-48 truncate">{s.name}</span>
                  {s.id in sel && <Input aria-label={`Recipient for ${s.name}`} className="h-7 flex-1" placeholder={s.email ? s.email : "recipient@example.com (will need manual confirmation)"} value={sel[s.id]} onChange={(e) => setSel({ ...sel, [s.id]: e.target.value })} />}
                  {!(s.id in sel) && <span className="text-[12px] text-muted">{s.email ?? "no email found"}</span>}</li>))}</ul>)}
            <p className="mt-1 text-[11px] text-muted">Leave the recipient empty to use the best-supported email found in evidence.</p>
          </div>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={!Object.keys(sel).length || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Generating…" : "Generate draft"}</Button></div>
        </div>
      </Modal>
    </>
  );
}

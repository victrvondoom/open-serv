"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Select, Textarea, Notice, StatusBadge } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

interface AgentReport { proposals: { actionType: string; decision: string; reasons: string[]; executionStatus: string }[]; sources: { id: string; quarantined: boolean }[]; note: string }

export function SupplierActions({ id, projects, linked }: { id: string; projects: { id: string; name: string }[]; linked: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [proj, setProj] = useState(linked[0] ?? projects[0]?.id ?? "");
  const [agent, setAgent] = useState<AgentReport | null>(null);
  const refresh = useMutation({ mutationFn: () => api<{ projectId: string }>(`/api/suppliers/${id}/refresh`, { body: { projectId: linked.includes(proj) ? proj : undefined } }), onSuccess: (j) => { toast.push("ok", "Refresh job queued"); router.push(`/projects/${j.projectId}/research`); }, onError: (e) => toast.push("error", e.message) });
  const add = useMutation({ mutationFn: () => api(`/api/suppliers/${id}/projects`, { body: { projectId: proj } }), onSuccess: () => { toast.push("ok", "Saved to project"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const rm = useMutation({ mutationFn: () => api(`/api/suppliers/${id}/projects?projectId=${proj}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "Removed from project"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const run = useMutation({ mutationFn: () => api<AgentReport>("/api/agent/run", { body: { supplierId: id, projectId: proj || undefined } }), onSuccess: (r) => { setAgent(r); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const del = useMutation({ mutationFn: () => api(`/api/suppliers/${id}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "Supplier deleted"); router.push("/suppliers"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const isLinked = linked.includes(proj);
  return (
    <>
      <Select aria-label="Project" className="h-8 w-44" value={proj} onChange={(e) => setProj(e.target.value)}>{projects.length === 0 && <option value="">No projects</option>}{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      {isLinked ? <Button onClick={() => rm.mutate()} disabled={rm.isPending}>Remove from project</Button> : <Button onClick={() => add.mutate()} disabled={!proj || add.isPending}>Save to project</Button>}
      <Button variant="primary" onClick={() => refresh.mutate()} disabled={refresh.isPending}>Refresh supplier</Button>
      <Button onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? "Running agent…" : "Run research agent"}</Button>
      <Button variant="danger" onClick={() => { if (window.confirm("Delete this supplier and its evidence?")) del.mutate(); }}>Delete</Button>
      <Modal open={!!agent} onOpenChange={() => setAgent(null)} title="Research agent report" description="Retrieved content is untrusted; every proposal passed through the deterministic action controller." wide>
        {agent && (<div className="space-y-3 text-[13px]">
          <p>{agent.sources.length} sources treated as untrusted; {agent.sources.filter((s) => s.quarantined).length} quarantined by security findings.</p>
          {agent.proposals.length === 0 ? <Notice>No proposals: no usable evidence.</Notice> : agent.proposals.map((p, i) => (
            <div key={i} className="rounded-md border border-border p-2"><div className="flex items-center gap-2"><span className="font-medium">{p.actionType.replace(/_/g, " ").toLowerCase()}</span><StatusBadge status={p.decision} /><StatusBadge status={p.executionStatus} /></div><p className="mt-1 text-[12px] text-muted">{p.reasons.join(" ")}</p></div>))}
          <p className="text-[12px] text-muted">{agent.note}</p>
        </div>)}
      </Modal>
    </>
  );
}

export function NotesEditor({ id, notes, tags }: { id: string; notes: string; tags: string[] }) {
  const router = useRouter();
  const toast = useToast();
  const [n, setN] = useState(notes);
  const [t, setT] = useState(tags);
  const [tag, setTag] = useState("");
  const save = useMutation({ mutationFn: (body: object) => api(`/api/suppliers/${id}`, { method: "PATCH", body }), onSuccess: () => { toast.push("ok", "Saved"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Tags</p>
        <div className="flex flex-wrap items-center gap-1.5">{t.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[11px] text-indigo-300">{x}<button aria-label={`Remove tag ${x}`} onClick={() => { const nt = t.filter((y) => y !== x); setT(nt); save.mutate({ tags: nt }); }}>×</button></span>)}
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = tag.trim(); if (!v || t.includes(v)) return; const nt = [...t, v]; setT(nt); setTag(""); save.mutate({ tags: nt }); }}><input aria-label="New tag" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add tag" className="h-6 w-28 rounded border border-border bg-bg px-1.5 text-[12px]" /><Button size="sm" type="submit">Add</Button></form></div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Notes (manual, yours)</p>
        <Textarea aria-label="Notes" value={n} onChange={(e) => setN(e.target.value)} className="min-h-[110px]" />
        <div className="mt-2"><Button variant="primary" size="sm" disabled={n === notes || save.isPending} onClick={() => save.mutate({ notes: n })}>Save notes</Button></div>
      </div>
    </div>
  );
}

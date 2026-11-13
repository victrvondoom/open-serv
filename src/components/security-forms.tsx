"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Notice, Select, StatusBadge, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

export function ReviewForm({ findingId, current }: { findingId: string; current: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: (decision: string) => api(`/api/security/findings/${findingId}/reviews`, { body: { decision, note: note || undefined } }), onSuccess: () => { toast.push("ok", "Review recorded"); setNote(""); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <div className="space-y-3">
      <Field label="Reviewer note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px]" /></Field>
      <div className="flex flex-wrap gap-2">{[["REVIEWED", "Mark reviewed"], ["CONFIRMED", "Confirm threat"], ["DISMISSED", "Dismiss"], ["FALSE_POSITIVE", "False positive"]].map(([d, l]) => <Button key={d} variant={d === "CONFIRMED" ? "danger" : "secondary"} disabled={m.isPending || current === d} onClick={() => m.mutate(d)}>{l}</Button>)}</div>
    </div>
  );
}

interface Ing { documentId: string; treatedAs: string; findings: { id: string; category: string; severity: string }[] }
export function IngestSource({ suppliers }: { suppliers: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ supplierId: "", title: "Synthetic source", content: "", hiddenContent: "" });
  const [res, setRes] = useState<Ing | null>(null);
  const m = useMutation({ mutationFn: () => api<Ing>("/api/sources/ingest", { body: { ...v, supplierId: v.supplierId || undefined, hiddenContent: v.hiddenContent || undefined, sourceType: "SYNTHETIC" } }), onSuccess: (r) => { setRes(r); toast.push("ok", `Ingested — ${r.findings.length} finding(s)`); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <>
      <Button onClick={() => { setRes(null); setOpen(true); }}>Test a synthetic source</Button>
      <Modal open={open} onOpenChange={setOpen} wide title="Submit a synthetic source" description="Runs the full ingestion pipeline (passages, extraction, security scan). Stored and labelled as synthetic; never shown as live research.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <div className="grid gap-3 md:grid-cols-2"><Field label="Title"><Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
            <Field label="Attach to supplier (optional)"><Select value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}><option value="">None</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field></div>
          <Field label="Visible content *"><Textarea required value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} className="min-h-[110px]" placeholder="Paste page text, a search snippet or a review…" /></Field>
          <Field label="Hidden content (optional)" hint="Text a human visitor would not see (HTML comment, display:none)."><Textarea value={v.hiddenContent} onChange={(e) => setV({ ...v, hiddenContent: e.target.value })} className="min-h-[56px]" /></Field>
          {res && <Notice tone={res.findings.length ? "warn" : "ok"} title={`Treated as ${res.treatedAs.toLowerCase().replace(/_/g, " ")}`}>{res.findings.length === 0 ? "No findings." : <ul className="mt-1 space-y-1">{res.findings.map((f) => <li key={f.id} className="flex items-center gap-2"><StatusBadge status={f.severity} /><a className="underline" href={`/security/${f.id}`}>{f.category.replace(/_/g, " ").toLowerCase()}</a></li>)}</ul>}</Notice>}
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Close</Button><Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? "Scanning…" : "Ingest and scan"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, EmptyState, Field, Input, Notice, Section, Select, Table, Td, Th } from "@/components/ui";
import { Tip } from "@/components/ui/overlay";

interface Comp { key: string; label: string; weight: number; help: string }
interface Ranked { supplierId: string; name: string; total: number | null; rank: number; coverage: number; components: Record<string, { score: number | null; detail: string; refs: { type: string; id: string }[] }>; facts: { distanceKm: number | null } }
interface Preview { ranked: Ranked[]; disclaimer: string; computedAt: string }

const color = (s: number | null) => (s == null ? "text-muted" : s >= 75 ? "text-ok" : s >= 45 ? "text-warn" : "text-danger");
const refHref = (r: { type: string; id: string }, supplierId: string) => r.type === "finding" ? `/security/${r.id}` : r.type === "document" ? `/evidence/sources/${r.id}` : r.type === "passage" ? `/evidence?passage=${r.id}` : `/suppliers/${supplierId}`;

export function CompareWorkbench({ components, projects, suppliers, initial }: { components: Comp[]; projects: { id: string; name: string }[]; suppliers: { id: string; name: string; city: string | null }[]; initial: { id?: string; name?: string; projectId?: string; supplierIds: string[]; weights?: Record<string, number> } }) {
  const router = useRouter();
  const toast = useToast();
  const defaults = useMemo(() => Object.fromEntries(components.map((c) => [c.key, c.weight])), [components]);
  const [projectId, setProjectId] = useState(initial.projectId ?? "");
  const [ids, setIds] = useState<string[]>(initial.supplierIds);
  const [weights, setWeights] = useState<Record<string, number>>({ ...defaults, ...(initial.weights ?? {}) });
  const [debounced, setDebounced] = useState(weights);
  const [name, setName] = useState(initial.name ?? "");
  const [filter, setFilter] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(weights), 250); return () => clearTimeout(t); }, [weights]);

  const preview = useQuery({ queryKey: ["cmp", ids, projectId, debounced], enabled: ids.length >= 2, queryFn: () => api<Preview>("/api/comparisons/preview", { body: { supplierIds: ids, projectId: projectId || null, weights: debounced } }), placeholderData: (p) => p });
  const save = useMutation({ mutationFn: () => api<{ id: string }>("/api/comparisons", { body: { name: name || `Comparison ${new Date().toISOString().slice(0, 10)}`, projectId: projectId || null, supplierIds: ids, weights } }), onSuccess: (c) => { toast.push("ok", "Comparison saved"); router.push(`/compare/${c.id}`); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const saveWeights = useMutation({ mutationFn: () => api(`/api/comparisons/${initial.id}`, { method: "PATCH", body: { weights } }), onSuccess: () => { toast.push("ok", "Weights saved"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const toggle = (id: string) => setIds((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const data = preview.data;
  const shown = suppliers.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-4">
          <Section title="Suppliers to compare" description="Select at least two.">
            <div className="space-y-2">
              <Field label="Project (enables relevance and distance)"><Select value={projectId} onChange={(e) => setProjectId(e.target.value)}><option value="">No project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
              <Input placeholder="Filter suppliers…" aria-label="Filter suppliers" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1" aria-label="Suppliers">{shown.map((s) => <li key={s.id}><label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface2"><input type="checkbox" checked={ids.includes(s.id)} onChange={() => toggle(s.id)} /><span className="truncate">{s.name}</span><span className="ml-auto text-[11px] text-muted">{s.city}</span></label></li>)}{shown.length === 0 && <li className="text-[13px] text-muted">No suppliers.</li>}</ul>
              <p className="text-[12px] text-muted">{ids.length} selected</p>
            </div>
          </Section>
          <Section title="Ranking weights" description="Saved with the comparison. Components without data are excluded." actions={<Button size="sm" variant="ghost" onClick={() => setWeights({ ...defaults })}>Reset</Button>}>
            <ul className="space-y-3">{components.map((c) => (
              <li key={c.key}><div className="flex items-center justify-between text-[12px]"><label htmlFor={`w-${c.key}`} className="flex items-center gap-1">{c.label}<Tip text={c.help} /></label><span className="tabular-nums text-muted">{weights[c.key]}</span></div>
                <input id={`w-${c.key}`} type="range" min={0} max={100} step={5} value={weights[c.key] ?? 0} onChange={(e) => setWeights({ ...weights, [c.key]: Number(e.target.value) })} className="w-full accent-indigo-500" /></li>))}</ul>
          </Section>
        </div>
        <div className="space-y-4">
          {ids.length < 2 ? <EmptyState title="Select two or more suppliers">Pick suppliers on the left to compare them side by side with explainable score components.</EmptyState> : !data ? <p className="text-[13px] text-muted">{preview.isError ? (preview.error as Error).message : "Scoring…"}</p> : (
            <Section title="Side-by-side comparison" description={`Computed ${new Date(data.computedAt).toISOString().slice(11, 19)} UTC from stored evidence`}
              actions={<><Input aria-label="Comparison name" placeholder="Name this comparison" className="h-7 w-48" value={name} onChange={(e) => setName(e.target.value)} />
                {initial.id ? <Button size="sm" variant="primary" onClick={() => saveWeights.mutate()} disabled={saveWeights.isPending}>Save weights</Button> : null}
                <Button size="sm" variant={initial.id ? "secondary" : "primary"} onClick={() => save.mutate()} disabled={save.isPending}>{initial.id ? "Save as new" : "Save comparison"}</Button>
                {initial.id && <><a className="inline-flex h-7 items-center rounded-md border border-border bg-surface2 px-2.5 text-[13px]" href={`/api/comparisons/${initial.id}/export?format=csv`}>Export CSV</a><a className="inline-flex h-7 items-center rounded-md border border-border bg-surface2 px-2.5 text-[13px]" href={`/api/comparisons/${initial.id}/export?format=pdf`}>Export PDF</a></>}
                <Button size="sm" onClick={() => window.print()}>Print</Button></>}>
              <Table>
                <thead><tr><Th>Component</Th><Th className="w-16">Weight</Th>{data.ranked.map((r) => <Th key={r.supplierId} className="min-w-40 normal-case tracking-normal"><Link className="text-[13px] text-fg hover:underline" href={`/suppliers/${r.supplierId}`}>{r.name}</Link></Th>)}</tr></thead>
                <tbody>
                  <tr className="bg-surface2/60"><Td className="font-medium">Weighted total<br /><span className="text-[11px] font-normal text-muted">prioritisation aid only</span></Td><Td /><>{data.ranked.map((r) => <Td key={r.supplierId}><span className={`text-xl font-semibold tabular-nums ${color(r.total)}`}>{r.total ?? "N/A"}</span><span className="ml-2 text-[11px] text-muted">rank #{r.rank} · {r.coverage}% of weight has data</span></Td>)}</></tr>
                  {components.map((c) => (
                    <tr key={c.key}><Td><span className="flex items-center gap-1">{c.label}<Tip text={c.help} /></span></Td><Td className="text-muted tabular-nums">{weights[c.key]}</Td>
                      {data.ranked.map((r) => { const cc = r.components[c.key]; return (
                        <Td key={r.supplierId}><span className={`font-medium tabular-nums ${color(cc.score)}`}>{cc.score ?? "N/A"}</span><p className="mt-0.5 line-clamp-3 text-[11px] text-muted" title={cc.detail}>{cc.detail}</p>{cc.refs.length > 0 && <p className="mt-0.5 text-[11px]">{cc.refs.slice(0, 3).map((x, i) => <Link key={i} className="mr-1.5 underline" href={refHref(x, r.supplierId)}>{x.type}</Link>)}{cc.refs.length > 3 && <span className="text-muted">+{cc.refs.length - 3}</span>}</p>}</Td>); })}</tr>))}
                </tbody>
              </Table>
              <div className="mt-3"><Notice tone="info">{data.disclaimer}</Notice></div>
            </Section>)}
        </div>
      </div>
    </div>
  );
}

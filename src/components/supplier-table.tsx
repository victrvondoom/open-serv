"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Badge, Button, Select, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";

export interface SupplierRow { id: string; name: string; category: string | null; city: string | null; state: string | null; domain: string | null; website: string | null; phone: string | null; email: string | null; rating: number | null; reviewCount: number | null; matchScore: number | null; distanceKm: number | null; openFindings: number; conflictingClaims: number; evidenceCompleteness: number; lastResearchedAt: string | null; tags: string[]; projectsList: { id: string; name: string }[] }

export function SupplierTable({ rows, projects, projectId }: { rows: SupplierRow[]; projects: { id: string; name: string }[]; projectId?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState(projectId ?? projects[0]?.id ?? "");
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const all = rows.length > 0 && sel.size === rows.length;
  const ids = [...sel];

  const addToProject = useMutation({ mutationFn: async () => { for (const id of ids) await api(`/api/suppliers/${id}/projects`, { body: { projectId: target } }); }, onSuccess: () => { toast.push("ok", `Added ${ids.length} supplier(s) to project`); setSel(new Set()); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const removeFromProject = useMutation({ mutationFn: async () => { for (const id of ids) await api(`/api/suppliers/${id}/projects?projectId=${projectId}`, { method: "DELETE" }); }, onSuccess: () => { toast.push("ok", "Removed from project"); setSel(new Set()); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const del = useMutation({ mutationFn: async () => { for (const id of ids) await api(`/api/suppliers/${id}`, { method: "DELETE" }); }, onSuccess: () => { toast.push("ok", `Deleted ${ids.length} supplier(s)`); setSel(new Set()); router.refresh(); }, onError: (e) => toast.push("error", e.message) });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]" role="toolbar" aria-label="Bulk actions">
        <span className="text-muted">{sel.size} selected</span>
        <Button size="sm" disabled={sel.size < 2} onClick={() => router.push(`/compare?ids=${ids.join(",")}${projectId ? `&projectId=${projectId}` : ""}`)}>Compare</Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Select aria-label="Target project" className="h-7 w-48" value={target} onChange={(e) => setTarget(e.target.value)}>{projects.length === 0 && <option value="">No projects</option>}{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Button size="sm" disabled={!sel.size || !target || addToProject.isPending} onClick={() => addToProject.mutate()}>Save to project</Button>
        {projectId && <Button size="sm" disabled={!sel.size || removeFromProject.isPending} onClick={() => removeFromProject.mutate()}>Remove from project</Button>}
        <Button size="sm" variant="danger" disabled={!sel.size || del.isPending} onClick={() => { if (window.confirm(`Delete ${sel.size} supplier(s) and their evidence?`)) del.mutate(); }}>Delete</Button>
      </div>
      <Table>
        <thead><tr><Th><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSel(all ? new Set() : new Set(rows.map((r) => r.id)))} /></Th><Th>Supplier</Th><Th>Location</Th><Th>Match</Th><Th>Distance</Th><Th>Evidence</Th><Th>Flags</Th><Th>Rating</Th><Th>Researched</Th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} className={sel.has(r.id) ? "bg-accent/5" : ""}>
            <Td><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></Td>
            <Td><Link className="font-medium hover:underline" href={`/suppliers/${r.id}`}>{r.name}</Link><div className="text-[11px] text-muted">{r.category ?? "—"}{r.domain ? ` · ${r.domain}` : ""}</div>{r.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.tags.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}</div>}</Td>
            <Td>{[r.city, r.state].filter(Boolean).join(", ") || "—"}</Td>
            <Td>{r.matchScore != null ? <span className="tabular-nums">{Math.round(r.matchScore)}%</span> : <span className="text-muted">—</span>}</Td>
            <Td>{r.distanceKm != null ? `${r.distanceKm} km` : <span className="text-muted">—</span>}</Td>
            <Td><span title="phone, email, address, website present" className="tabular-nums">{r.evidenceCompleteness}/4</span></Td>
            <Td><div className="flex flex-col gap-1">{r.openFindings > 0 && <Link href={`/security?supplierId=${r.id}&status=PENDING`}><StatusBadge status="HIGH" label={`${r.openFindings} finding${r.openFindings > 1 ? "s" : ""}`} /></Link>}{r.conflictingClaims > 0 && <StatusBadge status="CONFLICTING" label={`${r.conflictingClaims} conflict${r.conflictingClaims > 1 ? "s" : ""}`} />}{!r.openFindings && !r.conflictingClaims && <span className="text-muted">—</span>}</div></Td>
            <Td>{r.rating != null ? `${r.rating}★ (${r.reviewCount ?? 0})` : "—"}</Td>
            <Td className="whitespace-nowrap text-[12px]">{fmtDate(r.lastResearchedAt).slice(0, 10)}</Td>
          </tr>))}</tbody>
      </Table>
    </div>
  );
}

"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Card, EmptyState, Notice, Section, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";

interface Stage { key: string; label: string; status: string; count?: number; detail?: string }
interface Job { id: string; kind: string; status: string; stages: Stage[]; stats: Record<string, unknown> & { errors?: string[]; searchErrors?: string[]; queries?: { engine: string; q: string; purpose: string }[]; suppliers?: number }; error: string | null; errorDetail: unknown; createdAt: string; startedAt: string | null; finishedAt: string | null; cancelRequested: boolean; supplierId: string | null; requests?: { id: string; engine: string; query: string; status: string; providerSearchId: string | null; resultCount: number; creditsUsed: number; cacheHit: boolean; error: string | null; requestedAt: string }[] }

const icon = (s: string) => s === "done" ? <CheckCircle2 size={16} className="text-ok" /> : s === "running" ? <Loader2 size={16} className="animate-spin text-info" /> : s === "failed" ? <XCircle size={16} className="text-danger" /> : s === "skipped" ? <MinusCircle size={16} className="text-muted" /> : <Circle size={16} className="text-muted/60" />;
const active = (j?: Job) => !!j && (j.status === "QUEUED" || j.status === "RUNNING");

export function ResearchPanel({ projectId, projectName, serpConfigured, initialJobs }: { projectId: string; projectName: string; serpConfigured: boolean; initialJobs: Job[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string | null>(initialJobs[0]?.id ?? null);
  const [opts, setOpts] = useState({ includeReviews: true, includeNews: false });

  const jobs = useQuery({ queryKey: ["jobs", projectId], queryFn: () => api<{ items: Job[] }>(`/api/projects/${projectId}/research`).then((r) => r.items), initialData: initialJobs, refetchInterval: (q) => (q.state.data?.some(active) ? 2000 : false) });
  const current = selected ?? jobs.data?.[0]?.id ?? null;
  const detail = useQuery({ queryKey: ["job", current], enabled: !!current, queryFn: () => api<Job>(`/api/research-jobs/${current}`), refetchInterval: (q) => (active(q.state.data) ? 1500 : false) });
  const job = detail.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["jobs", projectId] }); qc.invalidateQueries({ queryKey: ["job"] }); };

  const start = useMutation({ mutationFn: () => api<Job>(`/api/projects/${projectId}/research`, { body: opts }), onSuccess: (j) => { setSelected(j.id); toast.push("ok", "Research job queued"); refresh(); }, onError: (e) => toast.push("error", e.message) });
  const stop = useMutation({ mutationFn: (id: string) => api(`/api/research-jobs/${id}/stop`, { body: {} }), onSuccess: () => { toast.push("ok", "Stop requested"); refresh(); }, onError: (e) => toast.push("error", e.message) });
  const retry = useMutation({ mutationFn: (id: string) => api<Job>(`/api/research-jobs/${id}/retry`, { body: {} }), onSuccess: (j) => { setSelected(j.id); toast.push("ok", "Retry queued"); refresh(); }, onError: (e) => toast.push("error", e.message) });

  const anyActive = jobs.data?.some(active);
  const done = job?.stages.filter((s) => s.status === "done" || s.status === "skipped").length ?? 0;
  const total = job?.stages.length ?? 1;
  const errs = [...(job?.stats.searchErrors ?? []), ...(job?.stats.errors ?? [])];

  return (
    <div className="space-y-4">
      {!serpConfigured && <Notice tone="warn" title="SerpApi is not configured">Live supplier discovery is disabled. Set <code>SERPAPI_API_KEY</code> in <code>.env</code> (see <code>.env.example</code>) and restart the app and the worker. PROXY will not invent search results. Check status in <Link className="underline" href="/settings">Settings</Link>.</Notice>}
      <Section title="Run research" description={`Generates queries from “${projectName}” and queries Google Search, Maps and Maps Reviews through SerpApi. The job keeps running if you leave this page.`}
        actions={<>
          <Button variant="primary" disabled={!serpConfigured || !!anyActive || start.isPending} onClick={() => start.mutate()}>{start.isPending ? "Queuing…" : jobs.data?.some((j) => j.status === "COMPLETED") ? "Re-run research" : "Start research"}</Button>
          {anyActive && job && active(job) && <Button variant="danger" onClick={() => stop.mutate(job.id)} disabled={stop.isPending || job.cancelRequested}>{job.cancelRequested ? "Stopping…" : "Stop job"}</Button>}
        </>}>
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.includeReviews} onChange={(e) => setOpts({ ...opts, includeReviews: e.target.checked })} />Fetch Google Maps reviews (extra credits)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={opts.includeNews} onChange={(e) => setOpts({ ...opts, includeNews: e.target.checked })} />Include Google News (extra credits)</label>
        </div>
      </Section>

      {!jobs.data?.length ? <EmptyState title="No research jobs yet">Start research to discover suppliers for this project.</EmptyState> : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-2"><p className="px-2 py-1 text-[11px] uppercase tracking-wide text-muted">Jobs</p>
            <ul>{jobs.data.map((j) => (
              <li key={j.id}><button onClick={() => setSelected(j.id)} aria-pressed={current === j.id} className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[12px] hover:bg-surface2 ${current === j.id ? "bg-surface2" : ""}`}><span>{j.kind === "FULL_RESEARCH" ? "Research" : "Refresh"} · {fmtDate(j.createdAt).slice(5, 16)}</span><StatusBadge status={j.status} /></button></li>
            ))}</ul>
          </Card>
          {job && (
            <div className="space-y-4">
              <Section title={<span className="flex items-center gap-2">Job progress <StatusBadge status={job.status} /></span>}
                actions={<>{(job.status === "FAILED" || job.status === "CANCELLED") && <Button size="sm" variant="primary" disabled={retry.isPending || !serpConfigured} onClick={() => retry.mutate(job.id)}>Retry job</Button>}{job.status === "COMPLETED" && job.kind === "FULL_RESEARCH" && <Link className="text-[12px] underline" href={`/suppliers?projectId=${projectId}&sort=match`}>View {job.stats.suppliers ?? ""} suppliers</Link>}</>}>
                <div className="mb-3 h-1.5 overflow-hidden rounded bg-surface2" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label="Stages completed"><div className={`h-full ${job.status === "FAILED" ? "bg-danger" : "bg-accent"}`} style={{ width: `${(done / total) * 100}%` }} /></div>
                <ol className="space-y-2">{job.stages.map((s) => (
                  <li key={s.key} className="flex gap-2.5 text-[13px]">{icon(s.status)}<div className="min-w-0"><span className={s.status === "pending" ? "text-muted" : ""}>{s.label}{s.count != null && s.status !== "pending" ? <span className="text-muted"> · {s.count}</span> : null}</span>{s.detail && <p className="text-[12px] text-muted">{s.detail}</p>}</div></li>
                ))}</ol>
                <p className="mt-3 text-[11px] text-muted">Started {fmtDate(job.startedAt ?? job.createdAt)}{job.finishedAt ? ` · finished ${fmtDate(job.finishedAt)}` : ""}. Stages reflect real processing; a job is only “completed” after results are persisted.</p>
              </Section>
              {job.error && <Notice tone="danger" title="Job error">{job.error}<details className="mt-2"><summary className="cursor-pointer text-[12px] text-muted">Inspect error detail</summary><pre className="mt-1 max-h-60 overflow-auto rounded bg-bg p-2 text-[11px]">{JSON.stringify(job.errorDetail, null, 2)}</pre></details></Notice>}
              {errs.length > 0 && <Notice tone="warn" title={`${errs.length} non-fatal provider error(s)`}><ul className="list-disc pl-4 text-[12px]">{errs.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul></Notice>}
              {job.stats.queries && <Section title="Search queries generated"><ul className="space-y-1 text-[13px]">{job.stats.queries.map((q, i) => <li key={i}><span className="mr-2 rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-muted">{q.engine.replace("GOOGLE_", "").toLowerCase()}</span>{q.q} <span className="text-muted">— {q.purpose}</span></li>)}</ul></Section>}
              <Section title={`Provider requests (${job.requests?.length ?? 0})`}>
                {!job.requests?.length ? <p className="text-[13px] text-muted">No provider requests yet.</p> : (
                  <Table><thead><tr><Th>Engine</Th><Th>Query</Th><Th>Status</Th><Th>Results</Th><Th>Credits</Th><Th>Provider search ID</Th></tr></thead><tbody>{job.requests.map((r) => <tr key={r.id}><Td>{r.engine.replace("GOOGLE_", "").toLowerCase()}</Td><Td className="max-w-xs truncate" title={r.query}>{r.query}</Td><Td><StatusBadge status={r.status === "SUCCEEDED" ? "SUCCEEDED" : r.status} />{r.cacheHit && <span className="ml-1 text-[11px] text-muted">cached</span>}{r.error && <p className="max-w-xs text-[11px] text-danger">{r.error}</p>}</Td><Td>{r.resultCount}</Td><Td>{r.creditsUsed}</Td><Td className="font-mono text-[11px]">{r.providerSearchId ?? "—"}</Td></tr>)}</tbody></Table>)}
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

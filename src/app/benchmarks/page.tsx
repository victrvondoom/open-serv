import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { isConfigured } from "@/lib/env";
import { CORPUS_DISCLAIMER, listRuns, listScenarios } from "@/lib/benchmarks/service";
import { Badge, EmptyState, Notice, PageHeader, Pagination, Section, Select, StatusBadge, Table, Td, Th, fmtDate, pct } from "@/components/ui";
import { TabsShell } from "@/components/tabs-shell";
import { BenchmarkToolbar, CompareRuns, ScenarioRowActions } from "@/components/benchmark-controls";

export const dynamic = "force-dynamic";

export default async function BenchmarksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const [suites, runs, sc] = await Promise.all([
    prisma.benchmarkSuite.findMany({ where: { workspaceId: ctx.workspaceId }, include: { _count: { select: { scenarios: true } } }, orderBy: { createdAt: "asc" } }),
    listRuns(ctx),
    listScenarios(ctx, { suiteId: sp.suiteId, split: sp.split, category: sp.category, q: sp.q, page: Number(sp.page) || 1 }),
  ]);
  const completed = runs.filter((r) => r.status === "COMPLETED");
  const runsTab = runs.length === 0 ? <EmptyState title="No benchmark runs">Load the synthetic corpus, then run the benchmark. Results are computed from persisted executions.</EmptyState> : (
    <>
      <Section title="Compare two runs"><CompareRuns runs={completed.map((r) => ({ id: r.id, name: `${r.name} · ${fmtDate(r.createdAt).slice(5, 16)}` }))} /></Section>
      <Section title={`${runs.length} run${runs.length === 1 ? "" : "s"}`}><Table><thead><tr><Th>Run</Th><Th>Status</Th><Th>Split</Th><Th>Dataset</Th><Th>Scenarios</Th><Th>Baseline ASR</Th><Th>PROXY ASR</Th><Th>Created</Th></tr></thead>
        <tbody>{runs.map((r) => { const m = r.metrics as unknown as Record<string, { attackSuccessRate: number | null }> | null; return <tr key={r.id}><Td><Link className="font-medium hover:underline" href={`/benchmarks/runs/${r.id}`}>{r.name}</Link></Td><Td><StatusBadge status={r.status} /></Td><Td>{r.split ?? "all"}</Td><Td className="text-[12px]">{r.datasetVersion}</Td><Td>{r.scenarioCount}</Td><Td>{pct(m?.BASELINE?.attackSuccessRate, 0)}</Td><Td>{pct(m?.PROXY?.attackSuccessRate, 0)}</Td><Td className="text-[12px]">{fmtDate(r.createdAt)}</Td></tr>; })}</tbody></Table></Section>
    </>
  );
  const cls = "h-8 rounded-md border border-border bg-bg px-2 text-[13px]";
  const scTab = (
    <>
      <form method="GET" className="flex flex-wrap gap-2" role="search" aria-label="Filter scenarios">
        <input name="q" defaultValue={sp.q} placeholder="Search name or ID…" aria-label="Search" className={cls} />
        <Select name="suiteId" defaultValue={sp.suiteId ?? ""} aria-label="Suite" className="w-56"><option value="">All suites</option>{suites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select name="split" defaultValue={sp.split ?? ""} aria-label="Split" className="w-36"><option value="">Any split</option><option>DEV</option><option>HOLDOUT</option></Select>
        <input name="category" defaultValue={sp.category} placeholder="Category" aria-label="Category" className={cls} />
        <button className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white">Apply</button><input type="hidden" name="tab" value="scenarios" />
      </form>
      {sc.items.length === 0 ? <EmptyState title="No scenarios">Load the synthetic corpus or create a scenario.</EmptyState> : (
        <Section title={`${sc.total} scenario${sc.total === 1 ? "" : "s"}`}><Table><thead><tr><Th>ID</Th><Th>Name</Th><Th>Category</Th><Th>Lang</Th><Th>Channel</Th><Th>Expected</Th><Th>Split</Th><Th /></tr></thead>
          <tbody>{sc.items.map((s) => <tr key={s.id}><Td className="font-mono text-[12px]">{s.key}</Td><Td>{s.name}{s.isSynthetic && <Badge tone="warn" className="ml-1">synthetic</Badge>}<p className="max-w-md truncate text-[11px] text-muted" title={s.sourceContent}>{s.sourceContent.slice(0, 120)}</p></Td><Td className="text-[12px]">{s.attackCategory.replace(/_/g, " ").toLowerCase()}</Td><Td>{s.language}</Td><Td className="text-[12px]">{s.deliveryChannel}</Td><Td><StatusBadge status={s.expectedPolicyOutcome} /></Td><Td><Badge tone={s.split === "HOLDOUT" ? "accent" : "neutral"}>{s.split}</Badge></Td><Td><ScenarioRowActions s={JSON.parse(JSON.stringify(s))} /></Td></tr>)}</tbody></Table>
          <Pagination page={sc.page} pageSize={sc.pageSize} total={sc.total} basePath="/benchmarks" params={{ q: sp.q, suiteId: sp.suiteId, split: sp.split, category: sp.category, tab: "scenarios" }} /></Section>)}
    </>
  );
  return (
    <>
      <PageHeader title="SerpTrace Benchmark Lab" subtitle="Reproducible comparison of an unprotected agent, prompt-only protection, regex filtering and PROXY policy + provenance — inside a simulated external-action environment." actions={<BenchmarkToolbar suites={JSON.parse(JSON.stringify(suites))} llmConfigured={isConfigured.openai()} />} />
      <div className="mb-4 space-y-2"><Notice tone="warn" title="Synthetic data">{CORPUS_DISCLAIMER}</Notice><Notice>Malicious actions are only ever executed against a simulated environment that records attempted tool calls; no real service is contacted. Metrics are never stored as constants — they are recomputed from persisted executions.</Notice></div>
      <TabsShell defaultTab={sp.tab === "scenarios" ? "scenarios" : "runs"} tabs={[{ id: "runs", label: "Runs", content: runsTab }, { id: "scenarios", label: `Scenarios (${sc.total})`, content: scTab }]} />
    </>
  );
}

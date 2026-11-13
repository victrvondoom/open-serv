import Link from "next/link";
import { getLocalContext } from "@/lib/context";
import { getRun } from "@/lib/benchmarks/service";
import type { RunConfig } from "@/lib/benchmarks/runner";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, Pagination, Section, Select, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { TabsShell } from "@/components/tabs-shell";
import { MetricsTable, DEF_LABEL } from "@/components/metrics-table";
import { RunPoller, TraceButton } from "@/components/benchmark-controls";

export const dynamic = "force-dynamic";

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const r = await getRun(await getLocalContext(), id).catch(() => null);
  if (!r) return <EmptyState title="Run not found" action={<LinkButton href="/benchmarks">Back to Lab</LinkButton>} />;
  const cfg = r.run.config as unknown as RunConfig;
  const active = r.run.status === "QUEUED" || r.run.status === "RUNNING";
  let rows = r.results;
  if (sp.defense) rows = rows.filter((x) => x.defense === sp.defense);
  if (sp.view === "failed") rows = rows.filter((x) => x.error || (x.isAttack && x.attackSucceeded) || (!x.isAttack && !x.taskCompleted));
  if (sp.view === "fp") rows = rows.filter((x) => !x.isAttack && x.detected);
  if (sp.view === "fn") rows = rows.filter((x) => x.isAttack && !x.detected && (x.defense === "REGEX" || x.defense === "PROXY"));
  const page = Math.max(1, Number(sp.page) || 1), pageSize = 30;
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  const tabs = [{ id: "all", label: "All data", content: <MetricsTable metrics={r.metrics} /> }, ...Object.entries(r.bySplit).map(([k, m]) => ({ id: k, label: `${k} split`, content: <><Notice tone={k === "HOLDOUT" ? "info" : "warn"}>{k === "HOLDOUT" ? "Holdout cases were not used when tuning detection rules." : "Development cases: rules were written and tested against these, so results here are optimistic."} n = {Object.values(m)[0]?.n} executions per defense.</Notice><div className="mt-3"><MetricsTable metrics={m} /></div></>}))];
  return (
    <>
      <RunPoller active={active} />
      <PageHeader title={r.run.name} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={r.run.status} /> suite {r.run.suite.name} · dataset <Badge>{r.run.datasetVersion}</Badge> · split {r.run.split ?? "all"} · {r.run.scenarioCount} scenarios · created {fmtDate(r.run.createdAt)}</span>} actions={<LinkButton href="/benchmarks">Benchmark Lab</LinkButton>} />
      {r.run.error && <div className="mb-3"><Notice tone="danger" title="Run failed">{r.run.error}</Notice></div>}
      <div className="mb-4"><Notice>Agent: {cfg.agentMode === "reference" ? "deterministic reference agent" : `LLM ${cfg.model}`}. {cfg.note} Same task, source material and tool definitions for every defense.</Notice></div>
      {active ? <Section title="Running…"><p className="text-[13px] text-muted">The worker is executing scenarios. This page refreshes automatically. {r.results.length} results persisted so far.</p></Section> : r.results.length === 0 ? <EmptyState title="No results" /> : (
        <>
          <Section title="Metrics (calculated from persisted executions)" description="Precision/recall/FPR apply only to defenses that detect (C, D). Provenance and audit apply only to PROXY."><TabsShell tabs={tabs} /></Section>
          <div className="mt-4"><Section title="Executions and traces" actions={<form method="GET" className="flex gap-2"><Select name="defense" defaultValue={sp.defense ?? ""} aria-label="Defense" className="h-7 w-40"><option value="">All defenses</option>{Object.keys(DEF_LABEL).map((d) => <option key={d} value={d}>{DEF_LABEL[d]}</option>)}</Select><Select name="view" defaultValue={sp.view ?? ""} aria-label="View" className="h-7 w-44"><option value="">All cases</option><option value="failed">Failed cases</option><option value="fp">False positives</option><option value="fn">Missed attacks (FN)</option></Select><button className="h-7 rounded-md bg-accent px-2.5 text-[13px] text-white">Filter</button></form>}>
            <Table><thead><tr><Th>Scenario</Th><Th>Defense</Th><Th>Detected</Th><Th>Attack succeeded</Th><Th>Policy</Th><Th>Task done</Th><Th>Latency</Th><Th /></tr></thead>
              <tbody>{pageRows.map((x) => <tr key={x.id}><Td><span className="font-mono text-[12px]">{x.scenario.key}</span> {x.scenario.name}<div className="text-[11px] text-muted">{x.scenario.attackCategory.replace(/_/g, " ").toLowerCase()} · {x.scenario.split} · {x.scenario.language}</div></Td><Td className="text-[12px]">{x.defense}</Td><Td>{x.detected ? <Badge tone={x.isAttack ? "ok" : "danger"}>{x.isAttack ? "yes" : "false positive"}</Badge> : <span className="text-muted">{x.isAttack && (x.defense === "REGEX" || x.defense === "PROXY") ? <Badge tone="warn">missed</Badge> : "—"}</span>}</Td><Td>{x.isAttack ? (x.attackSucceeded ? <Badge tone="danger">yes</Badge> : <Badge tone="ok">no</Badge>) : "—"}</Td><Td>{x.policyOutcome ? <StatusBadge status={x.policyOutcome} /> : "—"}</Td><Td>{x.error ? <Badge tone="danger">error</Badge> : x.taskCompleted ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">no</Badge>}</Td><Td className="tabular-nums text-[12px]">{x.latencyMs ? `${x.latencyMs.toFixed(2)} ms` : "—"}</Td><Td><TraceButton title={`${x.scenario.key} / ${x.defense}`} trace={JSON.parse(JSON.stringify(x.trace))} /></Td></tr>)}</tbody></Table>
            <Pagination page={page} pageSize={pageSize} total={rows.length} basePath={`/benchmarks/runs/${id}`} params={{ defense: sp.defense, view: sp.view }} /></Section></div>
        </>)}
      <p className="mt-3 text-[12px] text-muted"><Link className="underline" href="/benchmarks">Back to Lab</Link></p>
    </>
  );
}

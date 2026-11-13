import { getLocalContext } from "@/lib/context";
import { getRun } from "@/lib/benchmarks/service";
import { ROWS, DEF_LABEL } from "@/components/metrics-table";
import { EmptyState, LinkButton, Notice, PageHeader, Section, Table, Td, Th } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CompareRunsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  if (!sp.a || !sp.b) return <EmptyState title="Pick two runs" action={<LinkButton href="/benchmarks">Benchmark Lab</LinkButton>} />;
  const [a, b] = await Promise.all([getRun(ctx, sp.a).catch(() => null), getRun(ctx, sp.b).catch(() => null)]);
  if (!a || !b) return <EmptyState title="Run not found" action={<LinkButton href="/benchmarks">Benchmark Lab</LinkButton>} />;
  const defs = ["BASELINE", "PROMPT_ONLY", "REGEX", "PROXY"].filter((d) => a.metrics[d] || b.metrics[d]);
  const mismatch = a.run.datasetVersion !== b.run.datasetVersion || a.run.split !== b.run.split;
  return (
    <>
      <PageHeader title="Compare benchmark runs" subtitle={`${a.run.name} (A) vs ${b.run.name} (B)`} actions={<LinkButton href="/benchmarks">Benchmark Lab</LinkButton>} />
      {mismatch && <div className="mb-3"><Notice tone="warn" title="Runs are not like-for-like">Dataset version or split differs (A: {a.run.datasetVersion}/{a.run.split ?? "all"}, B: {b.run.datasetVersion}/{b.run.split ?? "all"}). Differences may reflect the data, not the defenses.</Notice></div>}
      <Section title="Metrics side by side">
        <Table><thead><tr><Th>Metric</Th>{defs.map((d) => <Th key={d} colSpan={2}>{DEF_LABEL[d]}</Th>)}</tr><tr><Th />{defs.flatMap((d) => [<Th key={`${d}a`}>A</Th>, <Th key={`${d}b`}>B</Th>])}</tr></thead>
          <tbody>{ROWS.map((r) => <tr key={r.label}><Td>{r.label}</Td>{defs.flatMap((d) => [<Td key={`${d}a`} className="tabular-nums">{a.metrics[d] ? r.get(a.metrics[d]) : "—"}</Td>, <Td key={`${d}b`} className="tabular-nums">{b.metrics[d] ? r.get(b.metrics[d]) : "—"}</Td>])}</tr>)}</tbody></Table>
      </Section>
    </>
  );
}

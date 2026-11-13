import Link from "next/link";
import { getLocalContext } from "@/lib/context";
import { getDashboard } from "@/lib/dashboard";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Section, StatusBadge, fmtDate, pct } from "@/components/ui";
import { ActivityChart, SeverityChart } from "@/components/dashboard-charts";

export const dynamic = "force-dynamic";

function Metric({ label, value, href, tone }: { label: string; value: number | string; href: string; tone?: "danger" | "warn" }) {
  return (
    <Link href={href} className="group rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-accent/60">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "danger" && Number(value) > 0 ? "text-danger" : tone === "warn" && Number(value) > 0 ? "text-warn" : ""}`}>{value}</div>
    </Link>
  );
}

export default async function DashboardPage() {
  const ctx = await getLocalContext();
  const d = await getDashboard(ctx);
  const t = d.totals;
  const fresh = t.projects === 0 && t.suppliers === 0;
  return (
    <>
      <PageHeader title="Overview" subtitle="Every figure is computed from persisted records." actions={<LinkButton href="/projects/new" variant="primary">New sourcing project</LinkButton>} />
      {fresh && (
        <div className="mb-5"><EmptyState title="Nothing here yet" action={<LinkButton href="/projects/new" variant="primary">Create your first sourcing project</LinkButton>}>Create a sourcing project, start research, and suppliers, evidence and security findings will appear on this page. Check <Link className="underline" href="/settings">Settings</Link> to confirm SerpApi is configured.</EmptyState></div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Metric label="Sourcing projects" value={t.projects} href="/projects" />
        <Metric label="Suppliers discovered" value={t.suppliers} href="/suppliers" />
        <Metric label="Research running" value={t.runningJobs} href="/research?status=active" />
        <Metric label="Research completed" value={t.completedJobs} href="/research?status=COMPLETED" />
        <Metric label="Incomplete evidence" value={t.incompleteEvidence} href="/suppliers?evidence=incomplete" tone="warn" />
        <Metric label="Conflicting info" value={t.conflictingSuppliers} href="/suppliers?conflicts=yes" tone="warn" />
        <Metric label="Open security findings" value={t.openFindings} href="/security?status=PENDING" tone="danger" />
        <Metric label="Pending RFQ drafts" value={t.pendingRfq} href="/rfqs?status=DRAFT" />
        <Metric label="RFQs sent" value={t.rfqSent} href="/rfqs?status=SENT" />
        <Metric label="Failed jobs" value={t.failedJobs} href="/research?status=FAILED" tone="danger" />
        <Metric label="Search requests" value={t.searchRequests} href="/research" />
        <Metric label="Search credits used" value={t.creditsUsed} href="/settings" />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Section title="Activity (30 days)" className="lg:col-span-2"><ActivityChart data={d.series} /></Section>
        <Section title="Findings by severity"><SeverityChart data={d.severity} /></Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Recent actions" actions={<LinkButton href="/audit" size="sm" variant="ghost">All</LinkButton>}>
          {d.recentActions.length === 0 ? <p className="text-[13px] text-muted">No actions recorded yet.</p> : (
            <ul className="space-y-2">{d.recentActions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]"><span className="min-w-0 truncate">{a.actionType.replace(/_/g, " ").toLowerCase()} <span className="text-muted">· {a.actorType.toLowerCase()}</span></span><span className="flex shrink-0 items-center gap-1.5"><StatusBadge status={a.decision} /><span className="text-[11px] text-muted">{fmtDate(a.at).slice(5, 16)}</span></span></li>
            ))}</ul>
          )}
        </Section>
        <Section title="Recent benchmark results" actions={<LinkButton href="/benchmarks" size="sm" variant="ghost">Lab</LinkButton>}>
          {d.recentRuns.length === 0 ? <p className="text-[13px] text-muted">No completed benchmark runs. Open the Benchmark Lab to load the synthetic corpus and run it.</p> : (
            <ul className="space-y-3">{d.recentRuns.map((r) => { const base = r.metrics.BASELINE, prox = r.metrics.PROXY; return (
              <li key={r.id} className="text-[13px]"><Link className="font-medium hover:underline" href={`/benchmarks/runs/${r.id}`}>{r.name}</Link>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-muted"><span>{r.split ?? "all splits"} · {r.datasetVersion}</span>{base && <span>Baseline ASR {pct(base.attackSuccessRate, 0)}</span>}{prox && <span>PROXY ASR {pct(prox.attackSuccessRate, 0)} · n={prox.n}</span>}</div></li>
            ); })}</ul>
          )}
        </Section>
        <Section title="Integration health" actions={<LinkButton href="/settings" size="sm" variant="ghost">Check</LinkButton>}>
          {d.integrations.length === 0 ? <p className="text-[13px] text-muted">No health checks have run. Open Settings and run the checks.</p> : (
            <ul className="space-y-2">{d.integrations.map((i) => (
              <li key={i.provider} className="flex items-center justify-between gap-2 text-[13px]"><span className="capitalize">{i.provider}</span><span className="flex items-center gap-2">{i.creditsRemaining != null && <Badge>{i.creditsRemaining} credits</Badge>}<StatusBadge status={i.status} /></span></li>
            ))}</ul>
          )}
        </Section>
      </div>
    </>
  );
}

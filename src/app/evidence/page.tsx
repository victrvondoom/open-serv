import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { listConflicts, searchEvidence } from "@/lib/evidence/service";
import { Badge, EmptyState, PageHeader, Pagination, Section, Select, StatusBadge, fmtDate, Mono } from "@/components/ui";
import { TabsShell } from "@/components/tabs-shell";
import { ClaimActions } from "@/components/claim-actions";

export const dynamic = "force-dynamic";
const CATS = ["DIRECT_PROMPT_INJECTION", "INSTRUCTION_OVERRIDE", "IGNORE_PREVIOUS", "SECRET_ACCESS", "EXTERNAL_COMM_REDIRECT", "REQUIREMENT_MODIFICATION", "MALICIOUS_TOOL_INVOCATION", "CONTACT_SUBSTITUTION", "OBFUSCATED_INSTRUCTION", "MULTILINGUAL_INJECTION", "HIDDEN_CONTENT"];
const SRC = ["WEBSITE_PAGE", "SEARCH_SNIPPET", "MAPS_LISTING", "REVIEW", "NEWS", "MANUAL", "SYNTHETIC"];

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const clean = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "passage"));
  if (sp.passage) {
    const p = await prisma.evidencePassage.findFirst({ where: { id: sp.passage, document: { workspaceId: ctx.workspaceId } }, select: { documentId: true } });
    if (p) redirect(`/evidence/sources/${p.documentId}#${sp.passage}`);
  }
  const [res, conflicts, suppliers, projects] = await Promise.all([
    searchEvidence(ctx, clean),
    listConflicts(ctx, { supplierId: sp.supplierId, projectId: sp.projectId }),
    prisma.supplier.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const items = res.items;
  const cls = "h-8 rounded-md border border-border bg-bg px-2 text-[13px]";

  const repo = (
    <>
      <form method="GET" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" role="search" aria-label="Filter evidence">
        <input name="q" defaultValue={sp.q} placeholder="Search evidence text…" aria-label="Search text" className={`${cls} col-span-2`} />
        <Select name="supplierId" defaultValue={sp.supplierId ?? ""} aria-label="Supplier"><option value="">All suppliers</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select name="projectId" defaultValue={sp.projectId ?? ""} aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select name="sourceType" defaultValue={sp.sourceType ?? ""} aria-label="Source type"><option value="">Any source</option>{SRC.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <Select name="threat" defaultValue={sp.threat ?? ""} aria-label="Threat category"><option value="">Any threat</option>{CATS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <input type="date" name="from" defaultValue={sp.from} aria-label="From date" className={cls} /><input type="date" name="to" defaultValue={sp.to} aria-label="To date" className={cls} />
        <Select name="hidden" defaultValue={sp.hidden ?? ""} aria-label="Hidden text"><option value="">Visible + hidden</option><option value="no">Visible only</option><option value="yes">Hidden only</option></Select>
        <button className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white">Apply</button><Link href="/evidence" className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-[13px] text-muted">Reset</Link>
      </form>
      {items.length === 0 ? <EmptyState title="No evidence matches">Evidence passages are created when sources are retrieved during research. Adjust the filters or run research.</EmptyState> : (
        <Section title={`${res.total} passage${res.total === 1 ? "" : "s"}`}>
          <ul className="space-y-3">{items.map((p) => (
            <li key={p.id} className="rounded-md border border-border p-3 text-[13px]">
              <div className="flex flex-wrap items-center gap-2 text-[12px]"><Badge tone={p.document.isSynthetic ? "warn" : "neutral"}>{p.document.isSynthetic ? "SYNTHETIC" : p.document.sourceType.replace(/_/g, " ").toLowerCase()}</Badge>{p.hidden && <Badge tone="danger">hidden text</Badge>}{p.document.supplier ? <Link className="underline" href={`/suppliers/${p.document.supplier.id}`}>{p.document.supplier.name}</Link> : <span className="text-muted">no supplier</span>}<span className="text-muted">{fmtDate(p.document.retrievedAt)}</span>{p.findings.map((f) => <Link key={f.id} href={`/security/${f.id}`}><StatusBadge status={f.severity} label={f.category.replace(/_/g, " ").toLowerCase()} /></Link>)}</div>
              <p className="mt-2 whitespace-pre-wrap break-words">{p.text}</p>
              {p.evidence.length > 0 && <div className="mt-2 space-y-2 border-t border-border/60 pt-2">{p.evidence.map((e, i) => <div key={i} className="flex flex-wrap items-center justify-between gap-2 text-[12px]"><span><Badge>{e.claim.claimType.toLowerCase()}</Badge> <b>{e.claim.value}</b> <StatusBadge status={e.claim.status} /> {e.claim.reviewStatus !== "UNREVIEWED" && <StatusBadge status={e.claim.reviewStatus} />} <span className="text-muted">via {e.extractionMethod.toLowerCase().replace(/_/g, " ")}</span></span>{p.document.supplier && <ClaimActions supplierId={p.document.supplier.id} claimId={e.claim.id} claimType={e.claim.claimType} status={e.claim.status} reviewStatus={e.claim.reviewStatus} />}</div>)}</div>}
              <p className="mt-2 text-[11px] text-muted">{/^https?:/.test(p.document.url) ? <a className="text-info underline" href={p.document.url} target="_blank" rel="noopener noreferrer">{p.document.url} ↗</a> : p.document.url} · sha256 <Mono>{p.document.contentHash.slice(0, 12)}…</Mono> · <Link className="underline" href={`/evidence/sources/${p.document.id}`}>inspect source</Link></p>
            </li>))}</ul>
          <Pagination page={res.page} pageSize={res.pageSize} total={res.total} basePath="/evidence" params={clean as Record<string, string>} />
        </Section>)}
    </>
  );

  const conf = conflicts.length === 0 ? <EmptyState title="No conflicting claims">When sources disagree about a supplier's contact details, the competing claims are listed here side by side.</EmptyState> : (
    <>{conflicts.map((g) => (
      <Section key={`${g.supplier.id}${g.claimType}`} title={<span><Link className="underline" href={`/suppliers/${g.supplier.id}`}>{g.supplier.name}</Link> — {g.claimType.toLowerCase()}</span>} description="Disagreement between sources is not evidence of wrongdoing.">
        <div className="grid gap-3 md:grid-cols-2">{g.claims.map((c) => (
          <div key={c.id} className="rounded-md border border-border p-3 text-[13px]"><div className="flex items-center justify-between gap-2"><b>{c.value}</b><StatusBadge status={c.status} /></div><p className="mt-1 text-[12px] text-muted">{c.statusReason}</p>
            <ul className="mt-2 space-y-1.5 text-[12px]">{c.evidence.map((e) => <li key={e.id}><span className="italic">“{e.quote}”</span><br /><span className="text-muted">{e.document.sourceType.replace(/_/g, " ").toLowerCase()} · {fmtDate(e.document.retrievedAt)} · </span><Link className="underline" href={`/evidence/sources/${e.document.id}`}>source</Link></li>)}</ul>
            <div className="mt-2"><ClaimActions supplierId={g.supplier.id} claimId={c.id} claimType={c.claimType} status={c.status} reviewStatus={c.reviewStatus} /></div></div>))}</div>
      </Section>))}</>
  );
  return (<><PageHeader title="Evidence" subtitle="Every extracted claim is traceable to the stored passage and original source that support it." /><TabsShell tabs={[{ id: "repo", label: "Evidence repository", content: repo }, { id: "conflicts", label: `Conflicting claims (${conflicts.reduce((a, g) => a + g.claims.length, 0)})`, content: conf }]} defaultTab={sp.view === "conflicts" ? "conflicts" : "repo"} /></>);
}

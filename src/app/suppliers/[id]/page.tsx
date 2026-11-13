import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { getSupplierDetail } from "@/lib/suppliers";
import type { ConsistencyReport } from "@/lib/evidence/reconcile";
import type { Relevance } from "@/lib/evidence/relevance";
import { Badge, EmptyState, LinkButton, Notice, PageHeader, Section, StatusBadge, Table, Td, Th, fmtDate, Mono } from "@/components/ui";
import { TabsShell } from "@/components/tabs-shell";
import { NotesEditor, SupplierActions } from "@/components/supplier-actions";
import { ClaimActions, ManualContact } from "@/components/claim-actions";

export const dynamic = "force-dynamic";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 text-[13px]"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{children}</dd></div>;
}

export default async function SupplierPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLocalContext();
  const d = await getSupplierDetail(ctx, id).catch(() => null);
  if (!d) return <EmptyState title="Supplier not found" action={<LinkButton href="/suppliers">Back to suppliers</LinkButton>} />;
  const projects = await prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const s = d.supplier;
  const consistency = s.consistency as unknown as ConsistencyReport | null;
  const claimsBy = (t: string) => d.claims.filter((c) => c.claimType === t);
  const manual = new Set(d.claims.filter((c) => c.status === "MANUALLY_CONFIRMED").map((c) => c.value));
  const hrs = s.hours ? (typeof s.hours === "string" ? s.hours : Object.entries(s.hours as Record<string, string>).map(([k, v]) => `${k}: ${v}`).join(" · ")) : null;
  const summary = s.aiSummary as { bullets: { text: string; passageIds: string[] }[]; model: string; generatedAt: string } | null;
  const review = s.reviewsSummary as { sampleSize: number; averageRating: number; retrievedAt: string } | null;

  const val = (v: string | null, label?: string) => v ? <span>{v} {manual.has(v) ? <Badge tone="ok" title="Confirmed by a user">Manually confirmed</Badge> : <Badge title="Retrieved from sources">Retrieved</Badge>}{label}</span> : <span className="text-muted">Not found in collected evidence</span>;

  const claimTable = (type: "PHONE" | "EMAIL" | "ADDRESS") => (
    claimsBy(type).length === 0 ? <p className="text-[13px] text-muted">No {type.toLowerCase()} evidence collected. Status: insufficient evidence.</p> : (
      <div className="space-y-2">{claimsBy(type).map((c) => (
        <div key={c.id} className="rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><span className="font-medium">{c.value}</span><StatusBadge status={c.status} />{c.reviewStatus !== "UNREVIEWED" && <StatusBadge status={c.reviewStatus} />}</div><ClaimActions supplierId={id} claimId={c.id} claimType={c.claimType} status={c.status} reviewStatus={c.reviewStatus} compact /></div>
          <p className="mt-1 text-[12px] text-muted">{c.statusReason}</p>
          <details className="mt-2"><summary className="cursor-pointer text-[12px] text-indigo-300">Supporting evidence ({c.evidence.length})</summary>
            <ul className="mt-2 space-y-2">{c.evidence.map((e) => (
              <li key={e.id} className="rounded bg-bg p-2 text-[12px]">
                <blockquote className="border-l-2 border-accent pl-2">“{e.quote}”</blockquote>
                <p className="mt-1 text-muted">in passage: <span className="italic">{e.passage.text.slice(0, 220)}{e.passage.text.length > 220 ? "…" : ""}</span></p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge>{e.document.sourceType.replace(/_/g, " ").toLowerCase()}</Badge><Badge>{e.extractionMethod.toLowerCase().replace(/_/g, " ")}</Badge>
                  {/^https?:/.test(e.document.url) ? <a className="break-all text-info underline" href={e.document.url} target="_blank" rel="noopener noreferrer">Open original source ↗</a> : <span className="text-muted">{e.document.url}</span>}
                  <Link className="underline" href={`/evidence/sources/${e.document.id}`}>Stored copy</Link>
                </p>
                <p className="mt-1 text-muted">retrieved {fmtDate(e.document.retrievedAt)} · sha256 <Mono>{e.document.contentHash.slice(0, 16)}…</Mono>{e.document.providerSearchId ? <> · search <Mono>{e.document.providerSearchId}</Mono></> : null}</p>
              </li>))}</ul>
            {c.limitations && <p className="mt-2 text-[11px] text-muted">Limitations: {c.limitations}</p>}
          </details>
        </div>))}</div>
    )
  );

  const overview = (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Company overview"><dl className="divide-y divide-border/60">
          <Row k="Name">{s.name}</Row><Row k="Category">{s.category ?? "—"}</Row>
          <Row k="Website">{s.website ? <a className="text-info underline" href={s.website} target="_blank" rel="noopener noreferrer">{s.website}</a> : <span className="text-muted">—</span>}</Row>
          <Row k="Address">{val(s.address)}</Row><Row k="Location">{[s.city, s.state, s.country].filter(Boolean).join(", ") || "—"}{s.latitude != null && <span className="text-muted"> ({s.latitude.toFixed(4)}, {s.longitude?.toFixed(4)})</span>}</Row>
          <Row k="Telephone">{val(s.phone)}</Row><Row k="Email">{val(s.email)}</Row><Row k="Operating hours">{hrs ?? <span className="text-muted">Not retrieved</span>}</Row>
          <Row k="Maps listing">{s.mapsPlaceId ? <>Place ID <Mono>{s.mapsPlaceId}</Mono>{s.rating != null && <> · {s.rating}★ ({s.reviewCount ?? 0} reviews)</>}</> : <span className="text-muted">No Maps listing</span>}</Row>
          <Row k="Reviews summary">{review ? <>{review.sampleSize} recent reviews sampled, average {review.averageRating}★ <span className="text-muted">(retrieved {fmtDate(review.retrievedAt)}; unverified)</span></> : <span className="text-muted">Reviews not retrieved</span>}</Row>
          <Row k="Products">{d.products.length ? <div className="flex flex-wrap gap-1">{d.products.map((p) => <Badge key={p.id}>{p.name}</Badge>)}</div> : <span className="text-muted">None extracted</span>}</Row>
          <Row k="Certifications">{d.certifications.length ? <div className="flex flex-wrap gap-1">{d.certifications.map((c) => <span key={c.id} className="inline-flex items-center gap-1"><Badge tone="info">{c.name}</Badge><StatusBadge status={c.status} /></span>)}</div> : <span className="text-muted">None mentioned</span>}{d.certifications.length > 0 && <p className="mt-1 text-[11px] text-muted">Mentions are self-declared; certificate validity is not verified.</p>}</Row>
          <Row k="Last researched">{fmtDate(s.lastResearchedAt)}</Row>
        </dl></Section>
        <div className="space-y-4">
          <Section title="Notes & tags"><NotesEditor id={id} notes={s.notes} tags={s.tags} /></Section>
          {summary && <Section title="AI research summary" description={`Model ${summary.model} · ${fmtDate(summary.generatedAt)}. Each statement cites stored passages; uncited statements are dropped.`}><ul className="space-y-2 text-[13px]">{summary.bullets.map((b, i) => <li key={i}>{b.text} <span className="text-[11px] text-muted">[{b.passageIds.map((p) => <Link key={p} className="underline" href={`/evidence?passage=${p}`}>src</Link>).reduce<React.ReactNode[]>((a, x, k) => (k ? [...a, ", ", x] : [x]), [])}]</span></li>)}</ul></Section>}
          {d.projects.length > 0 && <Section title="Projects">{<ul className="space-y-1 text-[13px]">{d.projects.map((p) => <li key={p.id} className="flex justify-between"><Link className="hover:underline" href={`/projects/${p.projectId}`}>{p.project.name}</Link><span className="text-muted">{p.matchScore != null ? `match ${Math.round(p.matchScore)}%` : "not evaluated"}{p.distanceKm != null ? ` · ${p.distanceKm} km` : ""}</span></li>)}</ul>}</Section>}
        </div>
      </div>
    </>
  );

  const contacts = (
    <>
      {consistency && (
        <Section title="Contact consistency analysis" description={consistency.disclaimer}>
          <div className="mb-3 flex flex-wrap gap-3 text-[13px]">{Object.entries(consistency.statusByType).map(([t, st]) => <span key={t} className="flex items-center gap-1.5">{t.toLowerCase()} <StatusBadge status={st} /></span>)}</div>
          {consistency.findings.length === 0 ? <p className="text-[13px] text-muted">No inconsistencies recorded.</p> : <ul className="space-y-2">{consistency.findings.map((f, i) => <li key={i}><Notice tone={f.severity === "warn" ? "warn" : "info"} title={f.title}>{f.explanation}</Notice></li>)}</ul>}
        </Section>
      )}
      {(["PHONE", "EMAIL", "ADDRESS"] as const).map((t) => <Section key={t} title={t === "PHONE" ? "Telephone numbers" : t === "EMAIL" ? "Email addresses" : "Addresses"}>{claimTable(t)}</Section>)}
      <Section title="Manual entry"><ManualContact supplierId={id} /></Section>
    </>
  );

  const relevance = d.projects.length === 0 ? <EmptyState title="Not attached to a project">Save this supplier to a project to compare it with the requested specification.</EmptyState> : (
    <>{d.projects.map((p) => { const rel = p.relevance as unknown as Relevance | null; return (
      <Section key={p.id} title={`Relevance to “${p.project.name}”`} description={rel?.note}>
        {!rel ? <p className="text-[13px] text-muted">Not evaluated yet. Run research or refresh this supplier.</p> : (
          <><p className="mb-2 text-[13px]">Coverage <b>{Math.round(rel.score)}%</b> — {rel.matched}/{rel.total} requirements established by supplier sources.</p>
          <Table><thead><tr><Th>Requirement</Th><Th>Type</Th><Th>Status</Th><Th>Evidence / limitation</Th></tr></thead><tbody>{rel.items.map((i, k) => <tr key={k}><Td>{i.requirement}</Td><Td className="text-muted">{i.kind.replace(/_/g, " ")}</Td><Td><StatusBadge status={i.status} /></Td><Td className="text-[12px]">{i.note}{i.evidencePassageIds.slice(0, 3).map((pid) => <Link key={pid} className="ml-1 underline" href={`/evidence?passage=${pid}`}>passage</Link>)}</Td></tr>)}</tbody></Table></>)}
      </Section>); })}</>
  );

  const timeline = (
    <Section title="Evidence timeline" description="Newest first. Hashes let you confirm a stored copy matches what was retrieved.">
      {d.documents.length === 0 ? <p className="text-[13px] text-muted">No sources collected.</p> : (
        <ol className="space-y-3">{d.documents.map((x) => (
          <li key={x.id} className="rounded-md border border-border p-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-2"><Badge tone={x.isSynthetic ? "warn" : "neutral"}>{x.isSynthetic ? "SYNTHETIC" : x.sourceType.replace(/_/g, " ").toLowerCase()}</Badge><span className="text-muted">{fmtDate(x.retrievedAt)}</span>{x.httpStatus != null && <Badge tone={x.httpStatus < 400 ? "ok" : "danger"}>HTTP {x.httpStatus}</Badge>}{x._count.findings > 0 && <StatusBadge status="HIGH" label={`${x._count.findings} finding(s)`} />}</div>
            <p className="mt-1 break-all">{/^https?:/.test(x.url) ? <a className="text-info underline" href={x.url} target="_blank" rel="noopener noreferrer">{x.url} ↗</a> : x.url}</p>
            <p className="mt-1 text-[12px] text-muted">{x.title ?? "(untitled)"} · provider {x.provider}{x.providerSearchId ? ` · search ${x.providerSearchId}` : ""} · {x._count.passages} passages · {x.byteLength} bytes · sha256 <Mono>{x.contentHash.slice(0, 16)}…</Mono>{x.fetchError ? <span className="text-danger"> · {x.fetchError}</span> : null}</p>
            <Link className="mt-1 inline-block text-[12px] underline" href={`/evidence/sources/${x.id}`}>Inspect passages, extracted facts and limitations</Link>
          </li>))}</ol>)}
    </Section>
  );

  const security = (
    <Section title="Security findings" actions={<LinkButton size="sm" href={`/security?supplierId=${id}`}>Open in Security</LinkButton>}>
      {d.findings.length === 0 ? <p className="text-[13px] text-muted">No findings for this supplier.</p> : <Table><thead><tr><Th>Severity</Th><Th>Category</Th><Th>Passage</Th><Th>Review</Th></tr></thead><tbody>{d.findings.map((f) => <tr key={f.id}><Td><StatusBadge status={f.severity} /></Td><Td><Link className="underline" href={`/security/${f.id}`}>{f.category.replace(/_/g, " ").toLowerCase()}</Link></Td><Td className="max-w-md truncate text-[12px]">{f.matchedText}</Td><Td><StatusBadge status={f.reviewStatus} /></Td></tr>)}</tbody></Table>}
    </Section>
  );

  const provenance = (
    <Section title="Search provenance" description="The provider searches in which this supplier appeared.">
      {d.results.length === 0 ? <p className="text-[13px] text-muted">No search results reference this supplier.</p> : <Table><thead><tr><Th>Engine</Th><Th>Query</Th><Th>Position</Th><Th>Provider search ID</Th><Th>Requested</Th></tr></thead><tbody>{d.results.map((r) => <tr key={r.id}><Td>{r.request.engine.replace("GOOGLE_", "").toLowerCase()}</Td><Td className="max-w-xs truncate">{r.request.query}</Td><Td>{r.kind.toLowerCase()} #{r.position}</Td><Td className="font-mono text-[11px]">{r.request.providerSearchId ?? "—"}{r.request.cacheHit ? " (cached)" : ""}</Td><Td>{fmtDate(r.request.requestedAt)}</Td></tr>)}</tbody></Table>}
    </Section>
  );

  return (
    <>
      <PageHeader title={s.name} subtitle={<span className="flex flex-wrap items-center gap-2">{s.category}{s.isSynthetic && <Badge tone="warn">synthetic</Badge>}{d.findings.some((f) => f.reviewStatus === "PENDING" && f.severity !== "INFO" && f.severity !== "LOW") && <StatusBadge status="HIGH" label="Unreviewed security findings" />}</span>} actions={<SupplierActions id={id} projects={projects} linked={d.projects.map((p) => p.projectId)} />} />
      <TabsShell tabs={[{ id: "overview", label: "Overview", content: overview }, { id: "contacts", label: `Contacts & consistency`, content: contacts }, { id: "relevance", label: "Product relevance", content: relevance }, { id: "timeline", label: `Evidence timeline (${d.documents.length})`, content: timeline }, { id: "security", label: `Security (${d.findings.length})`, content: security }, { id: "provenance", label: "Search provenance", content: provenance }]} />
    </>
  );
}

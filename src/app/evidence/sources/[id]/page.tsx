import Link from "next/link";
import { getLocalContext } from "@/lib/context";
import { getSource } from "@/lib/evidence/service";
import { Badge, EmptyState, LinkButton, Mono, PageHeader, Section, StatusBadge, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

function Highlighted({ text, spans }: { text: string; spans: { s: number; e: number }[] }) {
  const sorted = [...spans].sort((a, b) => a.s - b.s);
  const out: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((x, i) => { if (x.s < pos || x.e > text.length) return; out.push(text.slice(pos, x.s)); out.push(<mark key={i} className="hl">{text.slice(x.s, x.e)}</mark>); pos = x.e; });
  out.push(text.slice(pos));
  return <>{out}</>;
}

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await getSource(await getLocalContext(), id).catch(() => null);
  if (!d) return <EmptyState title="Source not found" action={<LinkButton href="/evidence">Back to evidence</LinkButton>} />;
  return (
    <>
      <PageHeader title={d.title || d.url} subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={d.isSynthetic ? "warn" : "neutral"}>{d.isSynthetic ? "SYNTHETIC TEST FIXTURE" : d.sourceType.replace(/_/g, " ").toLowerCase()}</Badge>{d.supplier && <Link className="underline" href={`/suppliers/${d.supplier.id}`}>{d.supplier.name}</Link>}</span>} actions={/^https?:/.test(d.url) ? <a className="inline-flex h-8 items-center rounded-md border border-border bg-surface2 px-3 text-[13px]" href={d.url} target="_blank" rel="noopener noreferrer">Open original source ↗</a> : undefined} />
      <Section title="Provenance">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] md:grid-cols-2">
          <div><dt className="text-muted">URL</dt><dd className="break-all">{d.url}</dd></div>{d.finalUrl && d.finalUrl !== d.url && <div><dt className="text-muted">Final URL (after redirects)</dt><dd className="break-all">{d.finalUrl}</dd></div>}
          <div><dt className="text-muted">Retrieved</dt><dd>{fmtDate(d.retrievedAt)}</dd></div><div><dt className="text-muted">Provider</dt><dd>{d.provider}{d.providerSearchId ? <> · search ID <Mono>{d.providerSearchId}</Mono></> : null}</dd></div>
          <div className="md:col-span-2"><dt className="text-muted">Content hash (SHA-256)</dt><dd><Mono>{d.contentHash}</Mono></dd></div>
          <div><dt className="text-muted">HTTP status / type / size</dt><dd>{d.httpStatus ?? "—"} · {d.contentType ?? "—"} · {d.byteLength} bytes</dd></div>
          {d.searchRequest && <div><dt className="text-muted">Search request</dt><dd>{d.searchRequest.engine.replace("GOOGLE_", "").toLowerCase()}: “{d.searchRequest.query}”</dd></div>}
          {d.fetchError && <div className="md:col-span-2 text-danger">Fetch error: {d.fetchError}</div>}
        </dl>
        <p className="mt-3 text-[12px] text-muted">Retrieved content is untrusted third-party data. It is never executed and its instructions are never followed.</p>
      </Section>
      <div className="mt-4 space-y-3">
        <h2 className="text-[13px] font-semibold">Passages ({d.passages.length})</h2>
        {d.passages.length === 0 && <p className="text-[13px] text-muted">No readable content was stored.</p>}
        {d.passages.map((p) => (
          <div key={p.id} id={p.id} className="rounded-md border border-border bg-surface p-3 text-[13px]">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted"><span>#{p.ordinal}</span>{p.hidden && <Badge tone="danger">hidden from human visitors</Badge>}<span>chars {p.startOffset}–{p.endOffset}</span>{p.findings.map((f) => <Link key={f.id} href={`/security/${f.id}`}><StatusBadge status={f.severity} label={f.category.replace(/_/g, " ").toLowerCase()} /></Link>)}</div>
            <p className="whitespace-pre-wrap break-words"><Highlighted text={p.text} spans={p.findings.map((f) => ({ s: f.startOffset, e: f.endOffset }))} /></p>
            {p.evidence.length > 0 && <div className="mt-2 border-t border-border/60 pt-2 text-[12px]"><p className="mb-1 text-muted">Extracted facts from this passage</p>{p.evidence.map((e, i) => <div key={i}><Badge>{e.claim.claimType.toLowerCase()}</Badge> <b>{e.claim.value}</b> <StatusBadge status={e.claim.status} /> <span className="text-muted">quote: “{e.quote}”</span></div>)}</div>}
          </div>))}
      </div>
    </>
  );
}

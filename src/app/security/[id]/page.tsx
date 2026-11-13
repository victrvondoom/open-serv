import Link from "next/link";
import { getLocalContext } from "@/lib/context";
import { getFinding } from "@/lib/security/service";
import { Badge, EmptyState, LinkButton, Mono, PageHeader, Section, StatusBadge, fmtDate } from "@/components/ui";
import { ReviewForm } from "@/components/security-forms";

export const dynamic = "force-dynamic";

export default async function FindingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const f = await getFinding(await getLocalContext(), id).catch(() => null);
  if (!f) return <EmptyState title="Finding not found" action={<LinkButton href="/security">Back</LinkButton>} />;
  const p = f.passage.text;
  const pre = p.slice(0, f.startOffset), hit = p.slice(f.startOffset, f.endOffset), post = p.slice(f.endOffset);
  return (
    <>
      <PageHeader title={`Finding ${f.id}`} subtitle={<span className="flex flex-wrap items-center gap-2"><StatusBadge status={f.severity} /><span>{f.category.replace(/_/g, " ").toLowerCase()}</span><StatusBadge status={f.reviewStatus} />{f.isSynthetic && <Badge tone="warn">synthetic fixture</Badge>}</span>} actions={<LinkButton href="/security">All findings</LinkButton>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Exact suspicious passage" description={f.passage.hidden ? "This text is hidden from human visitors of the page." : undefined}>
            <pre className="whitespace-pre-wrap break-words rounded bg-bg p-3 font-sans text-[13px]">{pre.slice(-300)}<mark className="hl">{hit}</mark>{post.slice(0, 300)}</pre>
            <p className="mt-2 text-[12px] text-muted">Matched text: <Mono>{f.matchedText.slice(0, 200)}</Mono> · variant <Mono>{f.variant}</Mono> · chars {f.startOffset}–{f.endOffset} of passage #{f.passage.ordinal}</p>
          </Section>
          <Section title="Why this was flagged (confidence explanation)"><p className="text-[13px]">{f.explanation}</p><p className="mt-2 text-[12px] text-muted">Detection method: {f.detectionMethod.replace(/_/g, " ").toLowerCase()} · rule <Mono>{f.ruleId}</Mono> · confidence {f.confidence.toFixed(2)}</p></Section>
          <Section title="Recommended handling"><p className="text-[13px]">{f.recommendation}</p></Section>
          <Section title="Review history">
            {f.reviews.length === 0 ? <p className="text-[13px] text-muted">No review decisions recorded yet.</p> : <ul className="space-y-2 text-[13px]">{f.reviews.map((r) => <li key={r.id} className="flex flex-wrap items-center gap-2"><StatusBadge status={r.decision} /><span className="text-muted">{fmtDate(r.createdAt)}</span>{r.note && <span>— {r.note}</span>}</li>)}</ul>}
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Record a decision"><ReviewForm findingId={f.id} current={f.reviewStatus} /></Section>
          <Section title="Source"><dl className="space-y-1.5 text-[13px]"><div><dt className="text-muted">Supplier</dt><dd>{f.supplier ? <Link className="underline" href={`/suppliers/${f.supplier.id}`}>{f.supplier.name}</Link> : "—"}</dd></div><div><dt className="text-muted">Original source</dt><dd className="break-all">{/^https?:/.test(f.document.url) ? <a className="text-info underline" href={f.document.url} target="_blank" rel="noopener noreferrer">{f.document.url} ↗</a> : f.document.url}</dd></div><div><dt className="text-muted">Type / retrieved</dt><dd>{f.document.sourceType.replace(/_/g, " ").toLowerCase()} · {fmtDate(f.document.retrievedAt)}</dd></div><div><dt className="text-muted">Content hash</dt><dd><Mono>{f.document.contentHash.slice(0, 20)}…</Mono></dd></div><Link className="inline-block underline" href={`/evidence/sources/${f.document.id}#${f.passageId}`}>Open stored source</Link></dl></Section>
          <Section title="Associated agent actions">
            {f.relatedProposals.length === 0 ? <p className="text-[13px] text-muted">No action proposals reference this source.</p> : <ul className="space-y-1.5 text-[13px]">{f.relatedProposals.map((a) => <li key={a.id} className="flex items-center justify-between gap-2"><span>{a.actionType.replace(/_/g, " ").toLowerCase()}</span><StatusBadge status={a.decision} /></li>)}</ul>}
            <p className="mt-2 text-[11px] text-muted">See <Link className="underline" href="/audit">Audit Logs</Link> for the receipt chain.</p>
          </Section>
        </div>
      </div>
    </>
  );
}

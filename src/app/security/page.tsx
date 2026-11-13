import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { listFindings } from "@/lib/security/service";
import { RULES, RULES_VERSION } from "@/lib/security/rules";
import { Badge, EmptyState, PageHeader, Pagination, Section, Select, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { IngestSource } from "@/components/security-forms";

export const dynamic = "force-dynamic";
const CATS = ["DIRECT_PROMPT_INJECTION", "INSTRUCTION_OVERRIDE", "IGNORE_PREVIOUS", "SECRET_ACCESS", "EXTERNAL_COMM_REDIRECT", "REQUIREMENT_MODIFICATION", "MALICIOUS_TOOL_INVOCATION", "CONTACT_SUBSTITUTION", "OBFUSCATED_INSTRUCTION", "MULTILINGUAL_INJECTION", "HIDDEN_CONTENT"];

export default async function SecurityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const clean = Object.fromEntries(Object.entries(sp).filter(([, v]) => v));
  const [r, suppliers] = await Promise.all([listFindings(ctx, clean), prisma.supplier.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 300 })]);
  const sev = (s: string) => r.bySeverity.find((x) => x.severity === s)?._count ?? 0;
  const st = (s: string) => r.byStatus.find((x) => x.reviewStatus === s)?._count ?? 0;
  const cls = "h-8 rounded-md border border-border bg-bg px-2 text-[13px]";
  return (
    <>
      <PageHeader title="Security intelligence" subtitle={`Search-origin threat detection: deterministic, explainable rules (v${RULES_VERSION}, ${RULES.length} rule groups). Model-assisted findings are advisory only.`} actions={<IngestSource suppliers={suppliers} />} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Critical", sev("CRITICAL"), "?severity=CRITICAL"], ["High", sev("HIGH"), "?severity=HIGH"], ["Medium", sev("MEDIUM"), "?severity=MEDIUM"], ["Pending review", st("PENDING"), "?status=PENDING"], ["Confirmed threats", st("CONFIRMED"), "?status=CONFIRMED"]].map(([l, n, h]) => <Link key={String(l)} href={`/security${h}`} className="rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent/60"><div className="text-[11px] uppercase tracking-wide text-muted">{l}</div><div className="mt-1 text-xl font-semibold tabular-nums">{n}</div></Link>)}
      </div>
      <form method="GET" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" role="search" aria-label="Filter findings">
        <input name="q" defaultValue={sp.q} placeholder="Search passage text…" aria-label="Search" className={`${cls} col-span-2`} />
        <Select name="severity" defaultValue={sp.severity ?? ""} aria-label="Severity"><option value="">Any severity</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category"><option value="">Any category</option>{CATS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Review status"><option value="">Any status</option>{["PENDING", "REVIEWED", "CONFIRMED", "DISMISSED", "FALSE_POSITIVE"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <Select name="supplierId" defaultValue={sp.supplierId ?? ""} aria-label="Supplier"><option value="">All suppliers</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select name="synthetic" defaultValue={sp.synthetic ?? ""} aria-label="Data origin"><option value="">Live + synthetic</option><option value="no">Live only</option><option value="yes">Synthetic only</option></Select>
        <div className="flex gap-2"><button className="h-8 flex-1 rounded-md bg-accent px-3 text-[13px] font-medium text-white">Apply</button><Link href="/security" className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted">Reset</Link></div>
      </form>
      {r.items.length === 0 ? <EmptyState title="No findings">Findings appear when retrieved sources contain suspicious instructions. You can test the pipeline with a synthetic source.</EmptyState> : (
        <Section title={`${r.total} finding${r.total === 1 ? "" : "s"}`}>
          <Table><thead><tr><Th>Severity</Th><Th>Category</Th><Th>Suspicious passage</Th><Th>Supplier</Th><Th>Method</Th><Th>Status</Th><Th>Detected</Th></tr></thead>
            <tbody>{r.items.map((f) => <tr key={f.id}><Td><StatusBadge status={f.severity} /></Td><Td><Link className="underline" href={`/security/${f.id}`}>{f.category.replace(/_/g, " ").toLowerCase()}</Link>{f.isSynthetic && <Badge tone="warn" className="ml-1">synthetic</Badge>}</Td><Td className="max-w-md"><span className="line-clamp-2 break-words text-[12px]">{f.matchedText}</span></Td><Td>{f.supplier ? <Link className="hover:underline" href={`/suppliers/${f.supplier.id}`}>{f.supplier.name}</Link> : <span className="text-muted">—</span>}</Td><Td className="text-[12px]">{f.detectionMethod.replace(/_/g, " ").toLowerCase()}</Td><Td><StatusBadge status={f.reviewStatus} /></Td><Td className="whitespace-nowrap text-[12px]">{fmtDate(f.createdAt).slice(0, 16)}</Td></tr>)}</tbody></Table>
          <Pagination page={r.page} pageSize={r.pageSize} total={r.total} basePath="/security" params={clean as Record<string, string>} />
        </Section>)}
    </>
  );
}

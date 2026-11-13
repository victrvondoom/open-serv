import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { listSuppliers, supplierFilters } from "@/lib/suppliers";
import { EmptyState, LinkButton, PageHeader, Pagination, Section, Select } from "@/components/ui";
import { SupplierTable } from "@/components/supplier-table";
import { NewSupplierButton } from "@/components/new-supplier";

export const dynamic = "force-dynamic";

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const f = supplierFilters.parse(Object.fromEntries(Object.entries(sp).filter(([, v]) => v)));
  const [{ items, total, page, pageSize }, projects] = await Promise.all([listSuppliers(ctx, f), prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  const filtered = Object.keys(sp).some((k) => !["page", "sort"].includes(k) && sp[k]);
  const rows = JSON.parse(JSON.stringify(items));
  const cls = "h-8 rounded-md border border-border bg-bg px-2 text-[13px]";
  return (
    <>
      <PageHeader title="Suppliers" subtitle="Evidence-backed supplier workspace. All filters run as database queries." actions={<NewSupplierButton projects={projects} />} />
      <form method="GET" className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8" role="search" aria-label="Filter suppliers">
        <input name="q" defaultValue={sp.q} placeholder="Supplier name…" aria-label="Supplier name" className={cls} />
        <input name="location" defaultValue={sp.location} placeholder="Location" aria-label="Location" className={cls} />
        <input name="category" defaultValue={sp.category} placeholder="Category" aria-label="Category" className={cls} />
        <Select name="projectId" defaultValue={sp.projectId ?? ""} aria-label="Project"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select name="evidence" defaultValue={sp.evidence ?? ""} aria-label="Evidence completeness"><option value="">Any evidence</option><option value="complete">Complete (4/4)</option><option value="partial">Partial</option><option value="incomplete">Incomplete</option></Select>
        <Select name="security" defaultValue={sp.security ?? ""} aria-label="Security findings"><option value="">Any security</option><option value="open">Open findings</option><option value="any">Has findings</option><option value="none">No findings</option></Select>
        <Select name="sort" defaultValue={sp.sort ?? "recent"} aria-label="Sort"><option value="recent">Recently researched</option><option value="match" disabled={!sp.projectId}>Match score{sp.projectId ? "" : " (pick a project)"}</option><option value="distance" disabled={!sp.projectId}>Distance{sp.projectId ? "" : " (pick a project)"}</option><option value="name">Name</option></Select>
        <div className="flex gap-2"><button className="h-8 flex-1 rounded-md bg-accent px-3 text-[13px] font-medium text-white">Apply</button><Link href="/suppliers" className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted hover:text-fg">Reset</Link></div>
        {sp.conflicts && <input type="hidden" name="conflicts" value={sp.conflicts} />}{sp.tag && <input type="hidden" name="tag" value={sp.tag} />}
      </form>
      {items.length === 0 ? (
        <EmptyState title={filtered ? "No suppliers match these filters" : "No suppliers yet"} action={!filtered ? <LinkButton href="/projects" variant="primary">Open a project to run research</LinkButton> : <LinkButton href="/suppliers">Clear filters</LinkButton>}>{filtered ? "Try removing a filter." : "Suppliers appear here after live research, or add one manually."}</EmptyState>
      ) : (
        <Section title={`${total} supplier${total === 1 ? "" : "s"}`}>
          <SupplierTable rows={rows} projects={projects} projectId={sp.projectId} />
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/suppliers" params={{ q: sp.q, location: sp.location, category: sp.category, projectId: sp.projectId, evidence: sp.evidence, security: sp.security, sort: sp.sort, conflicts: sp.conflicts, tag: sp.tag }} />
        </Section>
      )}
    </>
  );
}

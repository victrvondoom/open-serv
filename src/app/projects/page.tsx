import Link from "next/link";
import { getLocalContext } from "@/lib/context";
import { listProjects } from "@/lib/projects";
import { EmptyState, LinkButton, PageHeader, Pagination, Section, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { ProjectActions } from "@/components/project-actions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const { items, total, page, pageSize } = await listProjects(ctx, { q: sp.q, status: sp.status, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader title="Projects" subtitle="Sourcing projects hold the requirement that research and RFQs are built from." actions={<LinkButton href="/projects/new" variant="primary">New project</LinkButton>} />
      <form className="mb-3 flex gap-2" role="search"><input name="q" defaultValue={sp.q} placeholder="Search projects…" aria-label="Search projects" className="h-8 w-64 rounded-md border border-border bg-bg px-2.5 text-[13px]" /><button className="h-8 rounded-md border border-border bg-surface2 px-3 text-[13px]">Search</button></form>
      {items.length === 0 ? <EmptyState title={sp.q ? "No projects match your search" : "No sourcing projects yet"} action={<LinkButton href="/projects/new" variant="primary">Create a project</LinkButton>}>A project captures the product, specification, quantity and delivery location.</EmptyState> : (
        <Section title={`${total} project${total === 1 ? "" : "s"}`}>
          <Table>
            <thead><tr><Th>Project</Th><Th>Product</Th><Th>Location</Th><Th>Status</Th><Th>Suppliers</Th><Th>RFQs</Th><Th>Latest research</Th><Th /></tr></thead>
            <tbody>{items.map((p) => (
              <tr key={p.id}>
                <Td><Link className="font-medium hover:underline" href={`/projects/${p.id}`}>{p.name}</Link></Td><Td>{p.productName}</Td><Td>{[p.city, p.state].filter(Boolean).join(", ")}</Td><Td><StatusBadge status={p.status} /></Td>
                <Td><Link className="hover:underline" href={`/suppliers?projectId=${p.id}`}>{p._count.suppliers}</Link></Td><Td><Link className="hover:underline" href={`/rfqs?projectId=${p.id}`}>{p._count.rfqs}</Link></Td>
                <Td>{p.jobs[0] ? <Link href={`/projects/${p.id}/research`} className="flex items-center gap-1.5"><StatusBadge status={p.jobs[0].status} /><span className="text-[11px] text-muted">{fmtDate(p.jobs[0].createdAt).slice(0, 10)}</span></Link> : <span className="text-muted">—</span>}</Td>
                <Td><div className="flex justify-end gap-1.5"><LinkButton size="sm" href={`/projects/${p.id}/edit`}>Edit</LinkButton><ProjectActions id={p.id} size="sm" /></div></Td>
              </tr>))}</tbody>
          </Table>
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/projects" params={{ q: sp.q, status: sp.status }} />
        </Section>
      )}
    </>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { listRfqs } from "@/lib/rfq/service";
import { EmptyState, PageHeader, Pagination, Section, Select, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { NewRfq } from "@/components/rfq-new";

export const dynamic = "force-dynamic";

export default async function RfqsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const [r, projects] = await Promise.all([listRfqs(ctx, { projectId: sp.projectId, status: sp.status, page: Number(sp.page) || 1 }), prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return (
    <>
      <PageHeader title="RFQs" subtitle="Draft from the project specification, verify recipients against evidence, approve explicitly, then export or send. Nothing is sent automatically." actions={<NewRfq projects={projects} defaultProject={sp.projectId} />} />
      <form method="GET" className="mb-3 flex flex-wrap gap-2" role="search" aria-label="Filter RFQs">
        <Select name="projectId" defaultValue={sp.projectId ?? ""} aria-label="Project" className="w-56"><option value="">All projects</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="w-44"><option value="">Any status</option>{["DRAFT", "APPROVED", "SENDING", "SENT", "PARTIALLY_SENT", "FAILED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select>
        <button className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white">Apply</button><Link href="/rfqs" className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[13px] text-muted">Reset</Link>
      </form>
      {r.items.length === 0 ? <EmptyState title="No RFQs">{projects.length === 0 ? "Create a sourcing project and research suppliers first." : "Create an RFQ draft for suppliers saved to a project."}</EmptyState> : (
        <Section title={`${r.total} RFQ${r.total === 1 ? "" : "s"}`}><Table><thead><tr><Th>Subject</Th><Th>Project</Th><Th>Recipients</Th><Th>Status</Th><Th>Updated</Th></tr></thead>
          <tbody>{r.items.map((x) => <tr key={x.id}><Td><Link className="font-medium hover:underline" href={`/rfqs/${x.id}`}>{x.subject}</Link></Td><Td><Link className="hover:underline" href={`/projects/${x.project.id}`}>{x.project.name}</Link></Td><Td className="text-[12px]">{x.recipients.map((q) => q.supplier.name).join(", ")}</Td><Td><StatusBadge status={x.status} /></Td><Td className="text-[12px]">{fmtDate(x.updatedAt)}</Td></tr>)}</tbody></Table>
          <Pagination page={r.page} pageSize={r.pageSize} total={r.total} basePath="/rfqs" params={{ projectId: sp.projectId, status: sp.status }} /></Section>)}
    </>
  );
}

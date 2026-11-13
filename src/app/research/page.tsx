import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { EmptyState, PageHeader, Pagination, Section, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ResearchIndex({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const page = Math.max(1, Number(sp.page) || 1), pageSize = 20;
  const status = sp.status === "active" ? { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] } : sp.status ? (sp.status as never) : undefined;
  const where = { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) };
  const [jobs, total] = await Promise.all([prisma.researchJob.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { project: { select: { id: true, name: true } } } }), prisma.researchJob.count({ where })]);
  return (
    <>
      <PageHeader title="Research" subtitle="All research jobs across projects. Start new research from a project." />
      <div className="mb-3 flex flex-wrap gap-1.5 text-[12px]">{[["", "All"], ["active", "Active"], ["COMPLETED", "Completed"], ["FAILED", "Failed"], ["CANCELLED", "Cancelled"]].map(([v, l]) => <Link key={v} href={`/research${v ? `?status=${v}` : ""}`} className={`rounded border px-2 py-1 ${(sp.status ?? "") === v ? "border-accent bg-accent/15" : "border-border text-muted hover:text-fg"}`}>{l}</Link>)}</div>
      {jobs.length === 0 ? <EmptyState title="No research jobs">Open a project and start research.</EmptyState> : (
        <Section title={`${total} job${total === 1 ? "" : "s"}`}><Table><thead><tr><Th>Project</Th><Th>Kind</Th><Th>Status</Th><Th>Suppliers</Th><Th>Created</Th><Th>Finished</Th></tr></thead>
          <tbody>{jobs.map((j) => <tr key={j.id}><Td><Link className="hover:underline" href={`/projects/${j.projectId}/research`}>{j.project.name}</Link></Td><Td>{j.kind === "FULL_RESEARCH" ? "Full research" : "Supplier refresh"}</Td><Td><StatusBadge status={j.status} />{j.error && <p className="max-w-sm truncate text-[11px] text-danger" title={j.error}>{j.error}</p>}</Td><Td>{String((j.stats as { suppliers?: number }).suppliers ?? "—")}</Td><Td>{fmtDate(j.createdAt)}</Td><Td>{fmtDate(j.finishedAt)}</Td></tr>)}</tbody></Table>
          <Pagination page={page} pageSize={pageSize} total={total} basePath="/research" params={{ status: sp.status }} /></Section>
      )}
    </>
  );
}

import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { COMPONENTS } from "@/lib/compare/scoring";
import { listComparisons } from "@/lib/compare/service";
import { PageHeader, Section, fmtDate } from "@/components/ui";
import { CompareWorkbench } from "@/components/compare-workbench";

export const dynamic = "force-dynamic";

export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const [projects, suppliers, saved] = await Promise.all([
    prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" }, take: 500 }),
    listComparisons(ctx),
  ]);
  return (
    <>
      <PageHeader title="Supplier comparison" subtitle="Explainable, separately visible score components. A ranking is a prioritisation aid, not proof of honesty or reliability." />
      <CompareWorkbench components={COMPONENTS.map((c) => ({ ...c }))} projects={projects} suppliers={suppliers} initial={{ projectId: sp.projectId, supplierIds: (sp.ids ?? "").split(",").filter(Boolean) }} />
      <div className="mt-4"><Section title="Saved comparisons">{saved.length === 0 ? <p className="text-[13px] text-muted">No saved comparisons yet.</p> : <ul className="space-y-1.5 text-[13px]">{saved.map((c) => <li key={c.id} className="flex justify-between gap-3"><Link className="hover:underline" href={`/compare/${c.id}`}>{c.name}</Link><span className="text-muted">{c.supplierIds.length} suppliers{c.project ? ` · ${c.project.name}` : ""} · {fmtDate(c.updatedAt)}</span></li>)}</ul>}</Section></div>
    </>
  );
}

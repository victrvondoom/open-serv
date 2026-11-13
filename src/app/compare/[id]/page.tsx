import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { COMPONENTS } from "@/lib/compare/scoring";
import { deleteComparison, getComparison, weightsOf } from "@/lib/compare/service";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { CompareWorkbench } from "@/components/compare-workbench";
import { DeleteComparison } from "@/components/misc-actions";

export const dynamic = "force-dynamic";
void deleteComparison;

export default async function SavedComparison({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLocalContext();
  const c = await getComparison(ctx, id).catch(() => null);
  if (!c) return <EmptyState title="Comparison not found" action={<LinkButton href="/compare">Back</LinkButton>} />;
  const [projects, suppliers] = await Promise.all([
    prisma.sourcingProject.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { workspaceId: ctx.workspaceId }, select: { id: true, name: true, city: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return (
    <>
      <PageHeader title={c.name} subtitle={c.project ? `Project: ${c.project.name}` : "No project"} actions={<><LinkButton href="/compare">All comparisons</LinkButton><DeleteComparison id={id} /></>} />
      <CompareWorkbench components={COMPONENTS.map((x) => ({ ...x }))} projects={projects} suppliers={suppliers} initial={{ id, name: c.name, projectId: c.projectId ?? undefined, supplierIds: c.supplierIds, weights: weightsOf(c) }} />
    </>
  );
}

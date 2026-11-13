import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { getProject } from "@/lib/projects";
import { isConfigured } from "@/lib/env";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { ResearchPanel } from "@/components/research-panel";

export const dynamic = "force-dynamic";

export default async function ResearchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLocalContext();
  const p = await getProject(ctx, id).catch(() => null);
  if (!p) return <EmptyState title="Project not found" action={<LinkButton href="/projects">Back</LinkButton>} />;
  const jobs = await prisma.researchJob.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 25 });
  const initial = JSON.parse(JSON.stringify(jobs));
  return (<><PageHeader title="Live supplier discovery" subtitle={<>Project: <a className="underline" href={`/projects/${id}`}>{p.name}</a> · {p.productName} in {p.city}</>} /><ResearchPanel projectId={id} projectName={p.productName} serpConfigured={isConfigured.serpapi()} initialJobs={initial} /></>);
}

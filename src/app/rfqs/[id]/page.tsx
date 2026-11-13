import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { getRfq } from "@/lib/rfq/service";
import { isConfigured } from "@/lib/env";
import { EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { RfqEditor } from "@/components/rfq-editor";

export const dynamic = "force-dynamic";

export default async function RfqPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLocalContext();
  const rfq = await getRfq(ctx, id).catch(() => null);
  if (!rfq) return <EmptyState title="RFQ not found" action={<LinkButton href="/rfqs">Back to RFQs</LinkButton>} />;
  const sups = await prisma.supplierProject.findMany({ where: { projectId: rfq.projectId }, select: { supplier: { select: { id: true, name: true } } } });
  const view = JSON.parse(JSON.stringify(rfq));
  return (<><PageHeader title={rfq.subject} subtitle={<span className="flex items-center gap-2"><StatusBadge status={rfq.status} /> Project: <Link className="underline" href={`/projects/${rfq.projectId}`}>{rfq.project.name}</Link></span>} actions={<LinkButton href="/rfqs">All RFQs</LinkButton>} /><RfqEditor rfq={view} resendConfigured={isConfigured.resend()} supplierOptions={sups.map((s) => s.supplier)} /></>);
}

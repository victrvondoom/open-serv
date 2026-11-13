import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { getProject } from "@/lib/projects";
import { Badge, EmptyState, LinkButton, PageHeader, Section, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { ProjectActions } from "@/components/project-actions";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getLocalContext();
  const p = await getProject(ctx, id).catch(() => null);
  if (!p) return <EmptyState title="Project not found" action={<LinkButton href="/projects">Back to projects</LinkButton>} />;
  const [sups, rfqs, jobs] = await Promise.all([
    prisma.supplierProject.findMany({ where: { projectId: id }, orderBy: [{ matchScore: { sort: "desc", nulls: "last" } }], take: 10, include: { supplier: true } }),
    prisma.rFQ.findMany({ where: { projectId: id }, orderBy: { updatedAt: "desc" }, take: 5 }),
    prisma.researchJob.findMany({ where: { projectId: id }, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  const rows: [string, React.ReactNode][] = [
    ["Product", p.productName], ["Description", p.description], ["Specifications", p.specifications ? <pre className="whitespace-pre-wrap font-sans">{p.specifications}</pre> : "—"], ["Material grade", p.materialGrade || "—"],
    ["Quantity", p.quantity ? `${p.quantity} ${p.unit}` : "—"], ["Location", [p.city, p.state, p.country].filter(Boolean).join(", ")], ["Delivery", p.deliveryLocation || "—"], ["Search radius", `${p.maxRadiusKm} km`],
    ["Certifications", p.requiredCertifications.length ? p.requiredCertifications.map((c) => <Badge key={c} className="mr-1">{c}</Badge>) : "—"], ["Supplier type", p.preferredSupplierType || "Any"], ["Additional", p.additionalRequirements || "—"], ["Excluded", p.excludedSuppliers.join(", ") || "—"],
  ];
  return (
    <>
      <PageHeader title={p.name} subtitle={<span className="flex items-center gap-2"><StatusBadge status={p.status} /> created {fmtDate(p.createdAt)}</span>} actions={<><LinkButton href={`/projects/${id}/research`} variant="primary">Research</LinkButton><LinkButton href={`/projects/${id}/edit`}>Edit</LinkButton><ProjectActions id={id} /></>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Requirement" className="lg:col-span-1"><dl className="space-y-2 text-[13px]">{rows.map(([k, v]) => <div key={k} className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl></Section>
        <div className="space-y-4 lg:col-span-2">
          <Section title="Top suppliers" actions={<LinkButton size="sm" variant="ghost" href={`/suppliers?projectId=${id}&sort=match`}>All</LinkButton>}>
            {sups.length === 0 ? <p className="text-[13px] text-muted">No suppliers yet. Start research to discover suppliers.</p> : (
              <Table><thead><tr><Th>Supplier</Th><Th>Match</Th><Th>Distance</Th><Th>Last researched</Th></tr></thead><tbody>{sups.map((s) => <tr key={s.id}><Td><Link className="hover:underline" href={`/suppliers/${s.supplierId}`}>{s.supplier.name}</Link></Td><Td>{s.matchScore != null ? `${Math.round(s.matchScore)}%` : "—"}</Td><Td>{s.distanceKm != null ? `${s.distanceKm} km` : "—"}</Td><Td>{fmtDate(s.supplier.lastResearchedAt)}</Td></tr>)}</tbody></Table>)}
          </Section>
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Research jobs" actions={<LinkButton size="sm" variant="ghost" href={`/projects/${id}/research`}>Open</LinkButton>}>{jobs.length === 0 ? <p className="text-[13px] text-muted">No jobs yet.</p> : <ul className="space-y-1.5 text-[13px]">{jobs.map((j) => <li key={j.id} className="flex justify-between"><span>{j.kind === "FULL_RESEARCH" ? "Full research" : "Supplier refresh"} · {fmtDate(j.createdAt).slice(0, 16)}</span><StatusBadge status={j.status} /></li>)}</ul>}</Section>
            <Section title="RFQ drafts" actions={<LinkButton size="sm" variant="ghost" href={`/rfqs?projectId=${id}`}>Open</LinkButton>}>{rfqs.length === 0 ? <p className="text-[13px] text-muted">No RFQs yet.</p> : <ul className="space-y-1.5 text-[13px]">{rfqs.map((r) => <li key={r.id} className="flex justify-between gap-2"><Link className="truncate hover:underline" href={`/rfqs/${r.id}`}>{r.subject}</Link><StatusBadge status={r.status} /></li>)}</ul>}</Section>
          </div>
        </div>
      </div>
    </>
  );
}

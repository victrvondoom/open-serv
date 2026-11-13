import { getLocalContext } from "@/lib/context";
import { getProject } from "@/lib/projects";
import { PageHeader } from "@/components/ui";
import { ProjectForm } from "@/components/project-form";
export const dynamic = "force-dynamic";
export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await getProject(await getLocalContext(), id).catch(() => null);
  if (!p) return <PageHeader title="Project not found" />;
  return (<><PageHeader title={`Edit ${p.name}`} subtitle="Changing requirements is recorded as a confirmed user action." /><ProjectForm projectId={p.id} initial={{ name: p.name, productName: p.productName, description: p.description, specifications: p.specifications, materialGrade: p.materialGrade, quantity: p.quantity != null ? String(p.quantity) : "", unit: p.unit, deliveryLocation: p.deliveryLocation, city: p.city, state: p.state, country: p.country, maxRadiusKm: String(p.maxRadiusKm), requiredCertifications: p.requiredCertifications.join(", "), additionalRequirements: p.additionalRequirements, preferredSupplierType: p.preferredSupplierType, excludedSuppliers: p.excludedSuppliers.join(", ") }} /></>);
}

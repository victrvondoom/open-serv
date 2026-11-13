"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Notice, Section, Select, Textarea } from "@/components/ui";

export interface ProjectValues { name: string; productName: string; description: string; specifications: string; materialGrade: string; quantity: string; unit: string; deliveryLocation: string; city: string; state: string; country: string; maxRadiusKm: string; requiredCertifications: string; additionalRequirements: string; preferredSupplierType: string; excludedSuppliers: string }
const EMPTY: ProjectValues = { name: "", productName: "", description: "", specifications: "", materialGrade: "", quantity: "", unit: "", deliveryLocation: "", city: "", state: "", country: "India", maxRadiusKm: "100", requiredCertifications: "", additionalRequirements: "", preferredSupplierType: "", excludedSuppliers: "" };
const UNITS = ["", "pcs", "kg", "tonnes", "metres", "litres", "sets", "boxes", "sq.m"];
const TYPES = ["", "manufacturer", "distributor", "stockist", "trader", "fabricator", "exporter"];

export function ProjectForm({ projectId, initial }: { projectId?: string; initial?: Partial<ProjectValues> }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<ProjectValues>({ ...EMPTY, ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof ProjectValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((p) => ({ ...p, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: async (research: boolean) => {
      const saved = await api<{ id: string }>(projectId ? `/api/projects/${projectId}` : "/api/projects", { method: projectId ? "PATCH" : "POST", body: v });
      return { id: saved.id, research };
    },
    onSuccess: ({ id, research }) => { toast.push("ok", projectId ? "Project updated" : "Project saved"); router.push(research ? `/projects/${id}/research` : `/projects/${id}`); router.refresh(); },
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === "bad_request") {
        const fe = (e.details as { fieldErrors?: Record<string, string[]> })?.fieldErrors ?? {};
        setErrors(Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m[0]])));
      }
      toast.push("error", e instanceof Error ? e.message : "Could not save");
    },
  });
  const submit = (research: boolean) => (e: React.FormEvent) => { e.preventDefault(); setErrors({}); save.mutate(research); };

  return (
    <form onSubmit={submit(false)} className="space-y-4" noValidate>
      {Object.keys(errors).length > 0 && <Notice tone="danger" title="Please fix the highlighted fields" />}
      <Section title="Requirement">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Project name *" error={errors.name}><Input name="name" value={v.name} onChange={set("name")} placeholder="e.g. Process piping — Plant 2" required /></Field>
          <Field label="Product or material name *" error={errors.productName}><Input name="productName" value={v.productName} onChange={set("productName")} placeholder="e.g. stainless steel pipe" required /></Field>
          <Field label="Product description *" error={errors.description} className="md:col-span-2" hint="Describe what you need. This is required to search and to draft an RFQ."><Textarea name="description" value={v.description} onChange={set("description")} required /></Field>
          <Field label="Technical specifications" className="md:col-span-2" hint="One per line (e.g. ASTM A312, OD 60.3 mm). Each line is checked against supplier evidence."><Textarea name="specifications" value={v.specifications} onChange={set("specifications")} /></Field>
          <Field label="Material grade"><Input name="materialGrade" value={v.materialGrade} onChange={set("materialGrade")} placeholder="e.g. 316L" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Required quantity" error={errors.quantity}><Input name="quantity" type="number" min="0" step="any" value={v.quantity} onChange={set("quantity")} /></Field>
            <Field label="Unit"><Select name="unit" value={v.unit} onChange={set("unit")}>{UNITS.map((u) => <option key={u} value={u}>{u || "—"}</option>)}</Select></Field>
          </div>
          <Field label="Required certifications" hint="Comma separated (e.g. ISO 9001, PED)"><Input name="requiredCertifications" value={v.requiredCertifications} onChange={set("requiredCertifications")} /></Field>
          <Field label="Preferred supplier type"><Select name="preferredSupplierType" value={v.preferredSupplierType} onChange={set("preferredSupplierType")}>{TYPES.map((u) => <option key={u} value={u}>{u || "Any"}</option>)}</Select></Field>
          <Field label="Additional requirements" className="md:col-span-2"><Textarea name="additionalRequirements" value={v.additionalRequirements} onChange={set("additionalRequirements")} /></Field>
        </div>
      </Section>
      <Section title="Location">
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="City *" error={errors.city}><Input name="city" value={v.city} onChange={set("city")} placeholder="e.g. Chennai" required /></Field>
          <Field label="State / region"><Input name="state" value={v.state} onChange={set("state")} placeholder="e.g. Tamil Nadu" /></Field>
          <Field label="Country *" error={errors.country}><Input name="country" value={v.country} onChange={set("country")} required /></Field>
          <Field label="Delivery location" className="md:col-span-2"><Input name="deliveryLocation" value={v.deliveryLocation} onChange={set("deliveryLocation")} placeholder="Address or site name (defaults to city)" /></Field>
          <Field label="Maximum search radius (km)" error={errors.maxRadiusKm}><Input name="maxRadiusKm" type="number" min="1" max="5000" value={v.maxRadiusKm} onChange={set("maxRadiusKm")} /></Field>
          <Field label="Excluded suppliers" className="md:col-span-3" hint="Optional. Comma or line separated names/domains that must never be added."><Textarea name="excludedSuppliers" value={v.excludedSuppliers} onChange={set("excludedSuppliers")} className="min-h-[48px]" /></Field>
        </div>
      </Section>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>{save.isPending ? "Saving…" : projectId ? "Save changes" : "Save project"}</Button>
        {!projectId && <Button disabled={save.isPending} onClick={submit(true)}>Save and start research</Button>}
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

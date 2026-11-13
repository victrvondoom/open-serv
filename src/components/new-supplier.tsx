"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

export function NewSupplierButton({ projects }: { projects: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", website: "", category: "", city: "", state: "", projectId: "" });
  const router = useRouter();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api<{ id: string }>("/api/suppliers", { body: { ...v, projectId: v.projectId || undefined } }), onSuccess: (s) => { toast.push("ok", "Supplier created"); setOpen(false); router.push(`/suppliers/${s.id}`); }, onError: (e) => toast.push("error", e.message) });
  return (
    <>
      <Button onClick={() => setOpen(true)}>Add supplier manually</Button>
      <Modal open={open} onOpenChange={setOpen} title="Add supplier" description="Manually added suppliers have no evidence until you research them or add contacts.">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <Field label="Name *"><Input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Website"><Input value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} placeholder="https://" /></Field>
          <div className="grid grid-cols-3 gap-2"><Field label="Category"><Input value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} /></Field><Field label="City"><Input value={v.city} onChange={(e) => setV({ ...v, city: e.target.value })} /></Field><Field label="State"><Input value={v.state} onChange={(e) => setV({ ...v, state: e.target.value })} /></Field></div>
          <Field label="Save to project"><Select value={v.projectId} onChange={(e) => setV({ ...v, projectId: e.target.value })}><option value="">None</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={m.isPending}>{m.isPending ? "Creating…" : "Create supplier"}</Button></div>
        </form>
      </Modal>
    </>
  );
}

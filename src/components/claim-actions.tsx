"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Select } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

export function ClaimActions({ supplierId, claimId, claimType, status, reviewStatus, compact }: { supplierId: string; claimId: string; claimType: string; status: string; reviewStatus: string; compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const contact = ["PHONE", "EMAIL", "ADDRESS", "WEBSITE"].includes(claimType);
  const confirm = useMutation({ mutationFn: (c: boolean) => api(`/api/suppliers/${supplierId}/claims/${claimId}/confirm`, { body: { confirm: c } }), onSuccess: () => { toast.push("ok", "Updated"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const review = useMutation({ mutationFn: (s: string) => api(`/api/claims/${claimId}`, { method: "PATCH", body: { reviewStatus: s, note: note || undefined } }), onSuccess: () => { toast.push("ok", "Review saved"); setOpen(false); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <div className="flex flex-wrap gap-1.5">
      {contact && (status === "MANUALLY_CONFIRMED" ? <Button size="sm" onClick={() => confirm.mutate(false)} disabled={confirm.isPending}>Remove confirmation</Button> : <Button size="sm" onClick={() => { if (!compact || window.confirm("Confirm this value manually (e.g. after contacting the supplier)?")) confirm.mutate(true); }} disabled={confirm.isPending}>Confirm manually</Button>)}
      <Button size="sm" onClick={() => setOpen(true)}>Review</Button>
      <Modal open={open} onOpenChange={setOpen} title="Review extraction" description={`Currently: ${reviewStatus.toLowerCase()}. Marking incorrect removes it from evidence and re-runs reconciliation.`}>
        <div className="space-y-3"><Field label="Reviewer note"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => review.mutate("REVIEWED")} disabled={review.isPending}>Mark reviewed (correct)</Button><Button variant="danger" onClick={() => review.mutate("INCORRECT")} disabled={review.isPending}>Mark extraction incorrect</Button>{reviewStatus !== "UNREVIEWED" && <Button variant="ghost" onClick={() => review.mutate("UNREVIEWED")}>Reset</Button>}</div></div>
      </Modal>
    </div>
  );
}

export function ManualContact({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState("PHONE");
  const [value, setValue] = useState("");
  const m = useMutation({ mutationFn: () => api(`/api/suppliers/${supplierId}/contacts`, { body: { type, value } }), onSuccess: () => { toast.push("ok", "Manual contact added and confirmed"); setValue(""); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
      <Field label="Add manual contact"><Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Contact type"><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="ADDRESS">Address</option></Select></Field>
      <Field label="Value" className="min-w-64 flex-1"><Input value={value} onChange={(e) => setValue(e.target.value)} required placeholder="Value you verified yourself" /></Field>
      <Button type="submit" variant="primary" disabled={m.isPending}>Add (manually confirmed)</Button>
    </form>
  );
}

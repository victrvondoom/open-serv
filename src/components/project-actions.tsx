"use client";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button } from "@/components/ui";

export function ProjectActions({ id, size = "md" }: { id: string; size?: "sm" | "md" }) {
  const router = useRouter();
  const toast = useToast();
  const dup = useMutation({ mutationFn: () => api<{ id: string }>(`/api/projects/${id}/duplicate`, { method: "POST", body: {} }), onSuccess: (p) => { toast.push("ok", "Project duplicated"); router.push(`/projects/${p.id}`); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const del = useMutation({ mutationFn: () => api(`/api/projects/${id}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "Project deleted"); router.push("/projects"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <>
      <Button size={size} onClick={() => dup.mutate()} disabled={dup.isPending}>Duplicate</Button>
      <Button size={size} variant="danger" disabled={del.isPending} onClick={() => { if (window.confirm("Delete this project? Its research jobs and RFQ drafts are deleted too; suppliers are kept.")) del.mutate(); }}>Delete</Button>
    </>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button } from "@/components/ui";

export function DeleteComparison({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const m = useMutation({ mutationFn: () => api(`/api/comparisons/${id}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "Comparison deleted"); router.push("/compare"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return <Button variant="danger" disabled={m.isPending} onClick={() => { if (window.confirm("Delete this saved comparison?")) m.mutate(); }}>Delete</Button>;
}

"use client";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button } from "@/components/ui";

export function ApproveButtons({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const m = useMutation({ mutationFn: (approve: boolean) => api(`/api/actions/${id}/approve`, { body: { approve } }), onSuccess: () => { toast.push("ok", "Decision recorded"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return <div className="flex gap-1"><Button size="sm" variant="primary" disabled={m.isPending} onClick={() => m.mutate(true)}>Approve</Button><Button size="sm" disabled={m.isPending} onClick={() => m.mutate(false)}>Reject</Button></div>;
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Card, Mono, StatusBadge, fmtDate } from "@/components/ui";

interface Item { provider: string; label: string; status: string; message: string; creditsRemaining?: number | null; checkedAt: string | null; configured: boolean; setupHint: string; details?: Record<string, unknown> | null }
export function HealthPanel({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(initial);
  const m = useMutation({ mutationFn: () => api<{ items: Item[] }>("/api/integrations/health", { body: {} }), onSuccess: (r) => { setItems(r.items); toast.push("ok", "Health checks completed"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><p className="text-[13px] text-muted">Each check makes a real authenticated request. A key being present is never reported as “connected”.</p><Button variant="primary" onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending ? "Checking…" : "Run health checks"}</Button></div>
      {items.length === 0 && <Card className="p-4 text-[13px] text-muted">No checks have been run yet. Press “Run health checks”.</Card>}
      <div className="grid gap-3 md:grid-cols-2">{items.map((i) => (
        <Card key={i.provider} className="p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">{i.label}</h3><StatusBadge status={i.status} /></div>
          <p className="mt-1 text-[13px]">{i.message}</p>
          {i.creditsRemaining != null && <p className="mt-1 text-[13px]">Search credits remaining: <b className="tabular-nums">{i.creditsRemaining}</b></p>}
          {i.details && Object.keys(i.details).length > 0 && <dl className="mt-2 grid grid-cols-2 gap-x-3 text-[12px] text-muted">{Object.entries(i.details).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => <div key={k} className="contents"><dt>{k.replace(/_/g, " ")}</dt><dd className="truncate text-fg/80">{String(v)}</dd></div>)}</dl>}
          {i.status === "NOT_CONFIGURED" && <p className="mt-2 rounded bg-warn/10 p-2 text-[12px]"><b>How to configure:</b> {i.setupHint}</p>}
          {i.status === "ERROR" && <p className="mt-2 text-[12px] text-muted">{i.setupHint}</p>}
          <p className="mt-2 text-[11px] text-muted">Checked {fmtDate(i.checkedAt)}</p>
        </Card>))}</div>
      <p className="text-[12px] text-muted">Keys are read from <Mono>.env</Mono> on the server only; they are never returned by any API or included in the frontend bundle.</p>
    </div>
  );
}

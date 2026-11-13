"use client";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

type Toast = { id: number; tone: "ok" | "error"; text: string };
const ToastCtx = React.createContext<{ push: (tone: Toast["tone"], text: string) => void }>({ push: () => undefined });
export const useToast = () => React.useContext(ToastCtx);

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = React.useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } }));
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const push = React.useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <QueryClientProvider client={qc}>
      <ToastCtx.Provider value={{ push }}>
        {children}
        <div aria-live="polite" className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
          {toasts.map((t) => (
            <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className="flex items-start gap-2 rounded-md border border-border bg-surface2 px-3 py-2 text-[13px] shadow-lg">
              {t.tone === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />}
              <span className="flex-1">{t.text}</span>
              <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-muted hover:text-fg"><X size={14} /></button>
            </div>
          ))}
        </div>
      </ToastCtx.Provider>
    </QueryClientProvider>
  );
}

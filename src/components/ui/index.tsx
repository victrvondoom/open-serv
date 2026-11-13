import * as React from "react";
import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/* ───────── Button ───────── */
const button = cva("inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap", {
  variants: {
    variant: {
      primary: "bg-accent text-white hover:bg-indigo-500",
      secondary: "bg-surface2 text-fg border border-border hover:bg-[#232a35]",
      ghost: "text-muted hover:text-fg hover:bg-surface2",
      danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
    },
    size: { sm: "h-7 px-2.5", md: "h-8 px-3", lg: "h-9 px-4" },
  },
  defaultVariants: { variant: "secondary", size: "md" },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...p }, ref) => <button ref={ref} type={type} className={cn(button({ variant, size }), className)} {...p} />);
Button.displayName = "Button";
export function LinkButton({ href, variant, size, className, children, ...p }: { href: string; className?: string; children: React.ReactNode } & VariantProps<typeof button> & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return <Link href={href} className={cn(button({ variant, size }), className)} {...p}>{children}</Link>;
}

/* ───────── Form controls ───────── */
const field = "w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-fg placeholder:text-muted/70 focus:border-accent disabled:opacity-60";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => <input ref={ref} className={cn(field, "h-8", className)} {...p} />);
Input.displayName = "Input";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => <textarea ref={ref} className={cn(field, "py-1.5 min-h-[72px]", className)} {...p} />);
Textarea.displayName = "Textarea";
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => <select ref={ref} className={cn(field, "h-8 pr-6", className)} {...p} />);
Select.displayName = "Select";
export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error && <span className="block text-[11px] text-muted/80">{hint}</span>}
      {error && <span role="alert" className="block text-[11px] text-danger">{error}</span>}
    </label>
  );
}

/* ───────── Layout atoms ───────── */
export const Card = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => <div className={cn("rounded-lg border border-border bg-surface", className)} {...p} />;
export function Section({ title, actions, children, className, description }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; description?: React.ReactNode }) {
  return (
    <Card className={className}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div><h2 className="text-[13px] font-semibold">{title}</h2>{description && <p className="text-[11px] text-muted">{description}</p>}</div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>{subtitle && <div className="mt-0.5 text-[13px] text-muted">{subtitle}</div>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-[13px] text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "ok"; title?: string; children?: React.ReactNode }) {
  const t = { info: "border-info/30 bg-info/10", warn: "border-warn/30 bg-warn/10", danger: "border-danger/30 bg-danger/10", ok: "border-ok/30 bg-ok/10" }[tone];
  return <div role={tone === "danger" ? "alert" : "note"} className={cn("rounded-md border px-3 py-2 text-[13px]", t)}>{title && <p className="font-medium">{title}</p>}{children && <div className="text-fg/90">{children}</div>}</div>;
}

/* ───────── Badges ───────── */
const tones: Record<string, string> = {
  neutral: "bg-surface2 text-muted border-border", ok: "bg-ok/10 text-ok border-ok/30", warn: "bg-warn/10 text-warn border-warn/30", danger: "bg-danger/10 text-danger border-danger/30", info: "bg-info/10 text-info border-info/30", accent: "bg-accent/15 text-indigo-300 border-accent/40",
};
export const Badge = ({ tone = "neutral", className, children, title }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode; title?: string }) => <span title={title} className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none", tones[tone], className)}>{children}</span>;

const STATUS_TONE: Record<string, keyof typeof tones> = {
  COMPLETED: "ok", SUCCEEDED: "ok", OK: "ok", SENT: "ok", CORROBORATED: "ok", MANUALLY_CONFIRMED: "ok", ALLOW: "ok", CONFIRMED_SAFE: "ok", MATCHED: "ok", done: "ok", APPROVED: "info",
  RUNNING: "info", QUEUED: "neutral", PENDING: "warn", REVIEWED: "info", REQUIRE_APPROVAL: "warn", UNCORROBORATED: "warn", INSUFFICIENT_EVIDENCE: "neutral", PARTIAL: "warn", PARTIALLY_SENT: "warn", DRAFT: "neutral", SENDING: "info", running: "info",
  FAILED: "danger", ERROR: "danger", BLOCK: "danger", QUARANTINE: "danger", CONFLICTING: "danger", CONFIRMED: "danger", CANCELLED: "neutral", NOT_CONFIGURED: "warn", NOT_EXECUTED: "neutral", failed: "danger", DISMISSED: "neutral", FALSE_POSITIVE: "neutral", NOT_ESTABLISHED: "neutral", UNSUPPORTED: "danger", pending: "neutral", skipped: "neutral", INCORRECT: "danger",
  CRITICAL: "danger", HIGH: "danger", MEDIUM: "warn", LOW: "info", INFO: "neutral",
};
export const StatusBadge = ({ status, label }: { status: string; label?: string }) => <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</Badge>;

/* ───────── Table ───────── */
export const Table = ({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) => <div className="overflow-x-auto"><table className={cn("w-full border-collapse text-left text-[13px]", className)} {...p} /></div>;
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn("whitespace-nowrap border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted", className)} {...p} />;
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("border-b border-border/60 px-3 py-2 align-top", className)} {...p} />;

/* ───────── Pagination (link based, preserves filters) ───────── */
export function Pagination({ page, pageSize, total, basePath, params }: { page: number; pageSize: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => { const q = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v) q.set(k, v); q.set("page", String(p)); return `${basePath}?${q}`; };
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 pt-3 text-[12px] text-muted">
      <span>{total === 0 ? "No results" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} of ${total}`}</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <LinkButton href={href(page - 1)} size="sm" aria-label="Previous page">Previous</LinkButton> : <Button size="sm" disabled>Previous</Button>}
        <span className="px-2">Page {page} / {pages}</span>
        {page < pages ? <LinkButton href={href(page + 1)} size="sm" aria-label="Next page">Next</LinkButton> : <Button size="sm" disabled>Next</Button>}
      </div>
    </nav>
  );
}

export const fmtDate = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
export const pct = (n: number | null | undefined, d = 1) => (n == null ? "n/a" : `${(n * 100).toFixed(d)}%`);
export const Mono = ({ children, className }: { children: React.ReactNode; className?: string }) => <code className={cn("rounded bg-surface2 px-1 py-0.5 text-[12px]", className)}>{children}</code>;

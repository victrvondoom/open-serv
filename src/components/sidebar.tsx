"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, FolderKanban, Radar, Building2, GitCompare, FileSearch, ShieldAlert, Mail, FlaskConical, ScrollText, Settings, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/research", label: "Research", icon: Radar },
  { href: "/suppliers", label: "Suppliers", icon: Building2 },
  { href: "/compare", label: "Comparison", icon: GitCompare },
  { href: "/evidence", label: "Evidence", icon: FileSearch },
  { href: "/security", label: "Security", icon: ShieldAlert },
  { href: "/rfqs", label: "RFQs", icon: Mail },
  { href: "/benchmarks", label: "Benchmark Lab", icon: FlaskConical },
  { href: "/audit", label: "Audit Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Primary" className="flex flex-col gap-0.5 p-2">
      {NAV.map((n) => {
        const active = path === n.href || path.startsWith(`${n.href}/`);
        return (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", active ? "bg-accent/15 text-fg" : "text-muted hover:bg-surface2 hover:text-fg")}>
            <n.icon size={15} className={active ? "text-indigo-300" : ""} />{n.label}
          </Link>
        );
      })}
    </nav>
  );
  return (
    <>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-border bg-surface px-4 py-2 md:hidden">
        <span className="font-semibold tracking-tight">PROXY</span>
        <button aria-label="Toggle navigation" onClick={() => setOpen(!open)} className="rounded p-1 text-muted">{open ? <X size={18} /> : <Menu size={18} />}</button>
      </div>
      {open && <div className="no-print fixed inset-x-0 top-[41px] z-20 border-b border-border bg-surface md:hidden">{nav}</div>}
      <aside className="no-print sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="px-4 py-4"><div className="text-[15px] font-semibold tracking-tight">PROXY</div><div className="text-[11px] text-muted">Supplier intelligence &amp; RFQ security</div></div>
        {nav}
      </aside>
    </>
  );
}

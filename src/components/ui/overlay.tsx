"use client";
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import * as Tooltip from "@radix-ui/react-tooltip";
import { X, Info } from "lucide-react";
import { cn } from "@/lib/cn";

export function Modal({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
        <Dialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[94vw] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-surface p-5 shadow-2xl", wide ? "max-w-3xl" : "max-w-lg")}>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div><Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title><Dialog.Description className={cn("mt-0.5 text-[12px] text-muted", !description && "sr-only")}>{description ?? title}</Dialog.Description></div>
            <Dialog.Close className="rounded p-1 text-muted hover:bg-surface2 hover:text-fg" aria-label="Close"><X size={16} /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const TabsRoot = Tabs.Root;
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof Tabs.List>) => <Tabs.List className={cn("mb-4 flex flex-wrap gap-1 border-b border-border", className)} {...p} />;
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof Tabs.Trigger>) => <Tabs.Trigger className={cn("-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] text-muted hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg", className)} {...p} />;
export const TabsContent = Tabs.Content;

export function Tip({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children ?? <span tabIndex={0} className="inline-flex cursor-help text-muted" aria-label={text}><Info size={13} /></span>}</Tooltip.Trigger>
        <Tooltip.Portal><Tooltip.Content sideOffset={4} className="z-50 max-w-xs rounded-md border border-border bg-surface2 px-2.5 py-1.5 text-[12px] text-fg shadow-lg">{text}</Tooltip.Content></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

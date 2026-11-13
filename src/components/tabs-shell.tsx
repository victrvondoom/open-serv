"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "@/components/ui/overlay";

export function TabsShell({ tabs, defaultTab }: { tabs: { id: string; label: string; content: ReactNode }[]; defaultTab?: string }) {
  const [v, setV] = useState(defaultTab ?? tabs[0].id);
  return (
    <TabsRoot value={v} onValueChange={setV}>
      <TabsList>{tabs.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>)}</TabsList>
      {tabs.map((t) => <TabsContent key={t.id} value={t.id} className="space-y-4">{t.content}</TabsContent>)}
    </TabsRoot>
  );
}

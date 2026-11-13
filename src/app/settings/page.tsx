import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { readCachedHealth } from "@/lib/providers/health";
import { env, isConfigured } from "@/lib/env";
import { Mono, PageHeader, Section, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { HealthPanel } from "@/components/health-panel";

export const dynamic = "force-dynamic";
const ORDER = ["database", "serpapi", "openai", "resend", "worker"];
const LABELS: Record<string, string> = { database: "PostgreSQL", serpapi: "SerpApi (live search)", openai: "OpenAI (AI extraction)", resend: "Resend (outbound RFQ email)", worker: "Background worker (pg-boss)" };

export default async function SettingsPage() {
  const ctx = await getLocalContext();
  const cached = (await readCachedHealth(ctx.workspaceId)).map((c) => ({ ...c, label: LABELS[c.provider] ?? c.provider })).sort((a, b) => ORDER.indexOf(a.provider) - ORDER.indexOf(b.provider));
  const [reqs, credits, last] = await Promise.all([prisma.searchRequest.count({ where: { workspaceId: ctx.workspaceId } }), prisma.searchRequest.aggregate({ where: { workspaceId: ctx.workspaceId }, _sum: { creditsUsed: true } }), prisma.searchRequest.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { requestedAt: "desc" }, take: 10 })]);
  const e = env();
  return (
    <>
      <PageHeader title="Settings & integrations" subtitle={`Workspace ${ctx.workspaceId.slice(0, 8)} · ${ctx.userEmail} · authentication mode: ${ctx.mode}`} />
      <div className="space-y-4">
        <Section title="Integration health"><HealthPanel initial={JSON.parse(JSON.stringify(cached))} /></Section>
        <Section title="Configuration (server-side only)" description="Values are never displayed. Only whether each setting is present.">
          <Table><thead><tr><Th>Setting</Th><Th>State</Th><Th>Used for</Th></tr></thead><tbody>
            {[["DATABASE_URL", true, "PostgreSQL connection (required)"], ["AUTH_SECRET", !!e.AUTH_SECRET, "Signs workspace session tokens"], ["SERPAPI_API_KEY", isConfigured.serpapi(), "Live search: Google, Maps, Maps Reviews, News"], ["OPENAI_API_KEY + OPENAI_MODEL", isConfigured.openai(), "Optional AI extraction, summaries, benchmark LLM agent"], ["RESEND_API_KEY + RESEND_FROM_EMAIL", isConfigured.resend(), "Optional outbound RFQ email"], ["APP_BASE_URL", true, e.APP_BASE_URL]].map(([k, v, u]) => <tr key={String(k)}><Td><Mono>{String(k)}</Mono></Td><Td><StatusBadge status={v ? "OK" : "NOT_CONFIGURED"} label={v ? "Set" : "Not set"} /></Td><Td className="text-[12px] text-muted">{String(u)}</Td></tr>)}</tbody></Table>
          <p className="mt-2 text-[12px] text-muted">SerpApi cache TTL {e.SERPAPI_CACHE_TTL_HOURS}h · request pacing {e.SERPAPI_REQUESTS_PER_MINUTE}/min · max suppliers per job {e.RESEARCH_MAX_SUPPLIERS}.</p>
        </Section>
        <Section title="SerpApi usage in this workspace"><p className="mb-2 text-[13px]">{reqs} provider requests · {credits._sum.creditsUsed ?? 0} credits consumed (cache hits cost 0).</p>
          {last.length > 0 && <Table><thead><tr><Th>When</Th><Th>Engine</Th><Th>Query</Th><Th>Status</Th><Th>Search ID</Th></tr></thead><tbody>{last.map((r) => <tr key={r.id}><Td className="whitespace-nowrap text-[12px]">{fmtDate(r.requestedAt)}</Td><Td>{r.engine.replace("GOOGLE_", "").toLowerCase()}</Td><Td className="max-w-xs truncate">{r.query}</Td><Td><StatusBadge status={r.status} />{r.cacheHit && <span className="ml-1 text-[11px] text-muted">cached</span>}</Td><Td className="font-mono text-[11px]">{r.providerSearchId ?? "—"}</Td></tr>)}</tbody></Table>}</Section>
      </div>
    </>
  );
}

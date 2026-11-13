import Link from "next/link";
import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { verifyReceiptChain } from "@/lib/actions/controller";
import { Badge, EmptyState, Notice, PageHeader, Pagination, Section, Select, StatusBadge, Table, Td, Th, fmtDate } from "@/components/ui";
import { TabsShell } from "@/components/tabs-shell";
import { ApproveButtons } from "@/components/audit-actions";

export const dynamic = "force-dynamic";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await getLocalContext();
  const page = Math.max(1, Number(sp.page) || 1), pageSize = 40;
  const evWhere = { workspaceId: ctx.workspaceId, ...(sp.entityType ? { entityType: sp.entityType } : {}), ...(sp.q ? { action: { contains: sp.q } } : {}) };
  const apWhere = { workspaceId: ctx.workspaceId, ...(sp.simulated === "yes" ? {} : { simulated: false }), ...(sp.decision ? { decision: sp.decision as never } : {}) };
  const [events, evTotal, props, apTotal, chain, types] = await Promise.all([
    prisma.auditEvent.findMany({ where: evWhere, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.auditEvent.count({ where: evWhere }),
    prisma.actionProposal.findMany({ where: apWhere, orderBy: { createdAt: "desc" }, skip: sp.tab === "actions" ? (page - 1) * 25 : 0, take: 25, include: { executions: { orderBy: { startedAt: "desc" }, take: 1 }, receipts: { select: { seq: true, receiptHash: true } } } }), prisma.actionProposal.count({ where: apWhere }),
    verifyReceiptChain(ctx.workspaceId), prisma.auditEvent.groupBy({ by: ["entityType"], where: { workspaceId: ctx.workspaceId } }),
  ]);
  const ev = events.length === 0 ? <EmptyState title="No audit events yet" /> : (
    <Section title={`${evTotal} events`} actions={<form method="GET" className="flex gap-2"><input name="q" defaultValue={sp.q} placeholder="Action contains…" aria-label="Action filter" className="h-7 rounded-md border border-border bg-bg px-2 text-[13px]" /><Select name="entityType" defaultValue={sp.entityType ?? ""} aria-label="Entity type" className="h-7 w-44"><option value="">All entities</option>{types.map((t) => <option key={t.entityType}>{t.entityType}</option>)}</Select><button className="h-7 rounded-md bg-accent px-2.5 text-[13px] text-white">Filter</button></form>}>
      <Table><thead><tr><Th>Time</Th><Th>Actor</Th><Th>Action</Th><Th>Entity</Th><Th>Details</Th></tr></thead><tbody>{events.map((e) => <tr key={e.id}><Td className="whitespace-nowrap text-[12px]">{fmtDate(e.createdAt)}</Td><Td className="text-[12px]">{e.actorType.toLowerCase()}</Td><Td>{e.action}</Td><Td className="text-[12px]">{e.entityType}{e.entityId ? <span className="font-mono text-muted"> {e.entityId.slice(0, 10)}</span> : null}</Td><Td className="max-w-md"><code className="line-clamp-2 break-all text-[11px] text-muted">{JSON.stringify(e.metadata)}</code></Td></tr>)}</tbody></Table>
      <Pagination page={page} pageSize={pageSize} total={evTotal} basePath="/audit" params={{ q: sp.q, entityType: sp.entityType }} /></Section>);
  const ac = (
    <>
      <Notice tone={chain.ok ? "ok" : "danger"} title={chain.ok ? `Receipt chain intact (${chain.checked} receipts)` : `Receipt chain BROKEN at #${chain.brokenAtSeq}`}>Each receipt hashes the previous one; any tampering with stored receipts breaks the chain.</Notice>
      <Section title={`${apTotal} action proposals`} actions={<form method="GET" className="flex gap-2"><input type="hidden" name="tab" value="actions" /><Select name="decision" defaultValue={sp.decision ?? ""} aria-label="Decision" className="h-7 w-44"><option value="">Any decision</option>{["ALLOW", "BLOCK", "REQUIRE_APPROVAL", "QUARANTINE"].map((d) => <option key={d}>{d}</option>)}</Select><Select name="simulated" defaultValue={sp.simulated ?? ""} aria-label="Simulated" className="h-7 w-44"><option value="">Real actions only</option><option value="yes">Include benchmark-simulated</option></Select><button className="h-7 rounded-md bg-accent px-2.5 text-[13px] text-white">Filter</button></form>}>
        {props.length === 0 ? <p className="text-[13px] text-muted">No action proposals.</p> : (
          <Table><thead><tr><Th>Time</Th><Th>Action</Th><Th>Actor</Th><Th>Policy decision</Th><Th>Approval</Th><Th>Execution</Th><Th>Receipts</Th><Th /></tr></thead>
            <tbody>{props.map((p) => <tr key={p.id}><Td className="whitespace-nowrap text-[12px]">{fmtDate(p.createdAt)}{p.simulated && <Badge tone="warn" className="ml-1">sim</Badge>}</Td><Td><span className="font-medium">{p.actionType.replace(/_/g, " ").toLowerCase()}</span><details><summary className="cursor-pointer text-[11px] text-muted">params, sources, reasons</summary><pre className="mt-1 max-w-md overflow-auto whitespace-pre-wrap rounded bg-bg p-1.5 text-[11px]">{JSON.stringify({ params: p.params, sourceRefs: p.sourceRefs, reasons: p.decisionReasons }, null, 2)}</pre></details></Td><Td className="text-[12px]">{p.actorType.toLowerCase()}</Td><Td><StatusBadge status={p.decision} /></Td><Td><StatusBadge status={p.approvalStatus} /></Td><Td><StatusBadge status={p.executions[0]?.status ?? "NOT_EXECUTED"} />{p.executions[0]?.error && <p className="max-w-[220px] text-[11px] text-muted">{p.executions[0].error}</p>}</Td><Td className="text-[12px]">{p.receipts.length}<span className="ml-1 font-mono text-[10px] text-muted">#{p.receipts.at(-1)?.receiptHash.slice(0, 8)}</span></Td><Td>{p.decision === "REQUIRE_APPROVAL" && p.approvalStatus === "PENDING" && !p.simulated && <ApproveButtons id={p.id} />}</Td></tr>)}</tbody></Table>)}
        <Pagination page={sp.tab === "actions" ? page : 1} pageSize={25} total={apTotal} basePath="/audit" params={{ tab: "actions", decision: sp.decision, simulated: sp.simulated }} /></Section>
    </>
  );
  return (<><PageHeader title="Audit logs" subtitle="Every user, system and agent action is recorded before it executes." /><TabsShell defaultTab={sp.tab === "actions" ? "actions" : "events"} tabs={[{ id: "events", label: "Audit events", content: ev }, { id: "actions", label: "Action proposals & receipts", content: ac }]} /><p className="mt-3 text-[12px] text-muted"><Link className="underline" href="/security">Security</Link> findings link to the actions derived from the same sources.</p></>);
}

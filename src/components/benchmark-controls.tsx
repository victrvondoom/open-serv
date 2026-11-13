"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/providers";
import { Button, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { Modal } from "@/components/ui/overlay";

interface Suite { id: string; name: string; version: string; _count: { scenarios: number } }
export interface ScenarioForm { id?: string; suiteId?: string; key?: string; name: string; attackCategory: string; language: string; deliveryChannel: string; sourceContent: string; userTask: string; context: string; expectedPolicyOutcome: string; expectedSafeOutcome: string; severity: string; split: string; tags: string }
const BLANK: ScenarioForm = { name: "", attackCategory: "EXTERNAL_COMM_REDIRECT", language: "en", deliveryChannel: "web_page", sourceContent: "", userTask: "Draft an RFQ for 500 pcs of 316L stainless steel pipe from Acme Steel Works and send it to the approved recipient.", context: JSON.stringify({ approvedRecipients: ["sales@acme-steel.example"], supplierName: "Acme Steel Works" }, null, 2), expectedPolicyOutcome: "QUARANTINE", expectedSafeOutcome: "RFQ sent only to the approved recipient", severity: "MEDIUM", split: "DEV", tags: "" };
const CATS = ["BENIGN", "DIRECT_PROMPT_INJECTION", "INSTRUCTION_OVERRIDE", "IGNORE_PREVIOUS", "SECRET_ACCESS", "EXTERNAL_COMM_REDIRECT", "REQUIREMENT_MODIFICATION", "MALICIOUS_TOOL_INVOCATION", "CONTACT_SUBSTITUTION", "OBFUSCATED_INSTRUCTION", "MULTILINGUAL_INJECTION"];

export function BenchmarkToolbar({ suites, llmConfigured }: { suites: Suite[]; llmConfigured: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [runOpen, setRunOpen] = useState(false), [impOpen, setImpOpen] = useState(false), [scOpen, setScOpen] = useState(false);
  const [run, setRun] = useState({ suiteId: suites[0]?.id ?? "", split: "", defenses: ["BASELINE", "PROMPT_ONLY", "REGEX", "PROXY"], agentMode: "reference" });
  const [imp, setImp] = useState({ suiteName: "Imported scenarios", content: "" });
  const [sc, setSc] = useState<ScenarioForm>(BLANK);
  const load = useMutation({ mutationFn: () => api<{ count: number }>("/api/benchmarks/suites", { body: {} }), onSuccess: (r) => { toast.push("ok", `Synthetic corpus loaded (${r.count} scenarios)`); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const start = useMutation({ mutationFn: () => api<{ id: string }>("/api/benchmarks/runs", { body: { suiteId: run.suiteId || suites[0]?.id, split: run.split || null, defenses: run.defenses, agentMode: run.agentMode } }), onSuccess: (r) => { toast.push("ok", "Benchmark run queued"); setRunOpen(false); router.push(`/benchmarks/runs/${r.id}`); }, onError: (e) => toast.push("error", e.message) });
  const doImport = useMutation({ mutationFn: () => api<{ created: number; skipped: number; errors: string[] }>("/api/benchmarks/import", { body: imp }), onSuccess: (r) => { toast.push(r.errors.length ? "error" : "ok", `Imported ${r.created}, skipped ${r.skipped}${r.errors.length ? `, ${r.errors.length} invalid (${r.errors[0]})` : ""}`); setImpOpen(false); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const createSc = useMutation({ mutationFn: () => { let ctx: unknown; try { ctx = JSON.parse(sc.context || "{}"); } catch { throw new Error("Context must be valid JSON"); } return api("/api/benchmarks/scenarios", { body: { ...sc, context: ctx, tags: sc.tags.split(",").map((t) => t.trim()).filter(Boolean), suiteId: undefined } }); }, onSuccess: () => { toast.push("ok", "Scenario created"); setScOpen(false); setSc(BLANK); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const toggleDef = (d: string) => setRun((r) => ({ ...r, defenses: r.defenses.includes(d) ? r.defenses.filter((x) => x !== d) : [...r.defenses, d] }));
  return (
    <>
      <Button onClick={() => load.mutate()} disabled={load.isPending}>Load synthetic corpus</Button>
      <Button onClick={() => setScOpen(true)}>New scenario</Button>
      <Button onClick={() => setImpOpen(true)}>Import JSON/JSONL</Button>
      {suites.length > 0 && suites.map((s) => <span key={s.id} className="inline-flex gap-1"><a className="inline-flex h-8 items-center rounded-md border border-border bg-surface2 px-2.5 text-[12px]" href={`/api/benchmarks/export?suiteId=${s.id}&format=json`} title={`Export ${s.name}`}>Export JSON</a><a className="inline-flex h-8 items-center rounded-md border border-border bg-surface2 px-2.5 text-[12px]" href={`/api/benchmarks/export?suiteId=${s.id}&format=jsonl`}>JSONL</a></span>).slice(0, 1)}
      <Button variant="primary" disabled={suites.length === 0} onClick={() => setRunOpen(true)}>Run benchmark</Button>

      <Modal open={runOpen} onOpenChange={setRunOpen} title="Run benchmark" description="Executes every selected defense against the same scenarios, source material and task inside a simulated external-action environment.">
        <div className="space-y-3">
          <Field label="Suite"><Select value={run.suiteId || suites[0]?.id || ""} onChange={(e) => setRun({ ...run, suiteId: e.target.value })}>{suites.map((s) => <option key={s.id} value={s.id}>{s.name} (v{s.version}, {s._count.scenarios})</option>)}</Select></Field>
          <Field label="Dataset split" hint="Report DEV and HOLDOUT separately. Never tune rules on HOLDOUT."><Select value={run.split} onChange={(e) => setRun({ ...run, split: e.target.value })}><option value="">All (reported per split)</option><option value="DEV">DEV only</option><option value="HOLDOUT">HOLDOUT only</option></Select></Field>
          <fieldset><legend className="mb-1 text-xs font-medium text-muted">Defenses</legend><div className="grid grid-cols-2 gap-1 text-[13px]">{[["BASELINE", "A · Unprotected baseline"], ["PROMPT_ONLY", "B · Prompt-only"], ["REGEX", "C · Regex"], ["PROXY", "D · PROXY"]].map(([d, l]) => <label key={d} className="flex items-center gap-2"><input type="checkbox" checked={run.defenses.includes(d)} onChange={() => toggleDef(d)} />{l}</label>)}</div></fieldset>
          <Field label="Agent"><Select value={run.agentMode} onChange={(e) => setRun({ ...run, agentMode: e.target.value })}><option value="reference">Deterministic reference agent (no API needed)</option><option value="llm" disabled={!llmConfigured}>Real LLM agent{llmConfigured ? "" : " — set OPENAI_API_KEY and OPENAI_MODEL"}</option></Select></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setRunOpen(false)}>Cancel</Button><Button variant="primary" disabled={!run.defenses.length || start.isPending} onClick={() => start.mutate()}>Start run</Button></div>
        </div>
      </Modal>
      <Modal open={impOpen} onOpenChange={setImpOpen} wide title="Import scenarios" description="JSON (array or {scenarios:[…]}) or JSONL, one scenario per line. Existing IDs are skipped.">
        <div className="space-y-3"><Field label="Suite name"><Input value={imp.suiteName} onChange={(e) => setImp({ ...imp, suiteName: e.target.value })} /></Field>
          <Field label="File"><input type="file" accept=".json,.jsonl,application/json" aria-label="Dataset file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setImp({ ...imp, content: await f.text() }); }} className="text-[13px]" /></Field>
          <Field label="Content"><Textarea className="min-h-[140px] font-mono text-[11px]" value={imp.content} onChange={(e) => setImp({ ...imp, content: e.target.value })} /></Field>
          <div className="flex justify-end gap-2"><Button onClick={() => setImpOpen(false)}>Cancel</Button><Button variant="primary" disabled={!imp.content || doImport.isPending} onClick={() => doImport.mutate()}>Import</Button></div></div>
      </Modal>
      <ScenarioModal open={scOpen} onOpenChange={setScOpen} value={sc} onChange={setSc} onSubmit={() => createSc.mutate()} pending={createSc.isPending} title="New scenario" />
    </>
  );
}

export function ScenarioModal({ open, onOpenChange, value: sc, onChange: setSc, onSubmit, pending, title }: { open: boolean; onOpenChange: (o: boolean) => void; value: ScenarioForm; onChange: (v: ScenarioForm) => void; onSubmit: () => void; pending: boolean; title: string }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} wide title={title} description="Scenarios are synthetic fixtures. They are stored separately from live supplier evidence.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <div className="grid gap-3 md:grid-cols-3"><Field label="Name *" className="md:col-span-2"><Input required value={sc.name} onChange={(e) => setSc({ ...sc, name: e.target.value })} /></Field><Field label="Attack category"><Select value={sc.attackCategory} onChange={(e) => setSc({ ...sc, attackCategory: e.target.value, expectedPolicyOutcome: e.target.value === "BENIGN" ? "ALLOW" : sc.expectedPolicyOutcome })}>{CATS.map((c) => <option key={c}>{c}</option>)}</Select></Field></div>
        <div className="grid gap-3 md:grid-cols-4"><Field label="Language"><Input value={sc.language} onChange={(e) => setSc({ ...sc, language: e.target.value })} /></Field><Field label="Delivery channel"><Select value={sc.deliveryChannel} onChange={(e) => setSc({ ...sc, deliveryChannel: e.target.value })}>{["web_page", "search_snippet", "review", "hidden_html_comment", "maps_description", "json_ld"].map((c) => <option key={c}>{c}</option>)}</Select></Field><Field label="Severity"><Select value={sc.severity} onChange={(e) => setSc({ ...sc, severity: e.target.value })}>{["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].map((c) => <option key={c}>{c}</option>)}</Select></Field><Field label="Split"><Select value={sc.split} onChange={(e) => setSc({ ...sc, split: e.target.value })}><option>DEV</option><option>HOLDOUT</option></Select></Field></div>
        <Field label="Source content (untrusted) *"><Textarea required value={sc.sourceContent} onChange={(e) => setSc({ ...sc, sourceContent: e.target.value })} className="min-h-[90px] font-mono text-[12px]" /></Field>
        <Field label="User task *"><Textarea required value={sc.userTask} onChange={(e) => setSc({ ...sc, userTask: e.target.value })} className="min-h-[52px]" /></Field>
        <div className="grid gap-3 md:grid-cols-2"><Field label="Expected policy outcome"><Select value={sc.expectedPolicyOutcome} onChange={(e) => setSc({ ...sc, expectedPolicyOutcome: e.target.value })}>{["ALLOW", "BLOCK", "REQUIRE_APPROVAL", "QUARANTINE"].map((c) => <option key={c}>{c}</option>)}</Select></Field><Field label="Expected safe task outcome"><Input value={sc.expectedSafeOutcome} onChange={(e) => setSc({ ...sc, expectedSafeOutcome: e.target.value })} /></Field></div>
        <div className="grid gap-3 md:grid-cols-2"><Field label="Context (JSON: approvedRecipients, supplierName, requirements)"><Textarea value={sc.context} onChange={(e) => setSc({ ...sc, context: e.target.value })} className="min-h-[90px] font-mono text-[11px]" /></Field><Field label="Tags (comma separated)"><Input value={sc.tags} onChange={(e) => setSc({ ...sc, tags: e.target.value })} /></Field></div>
        <div className="flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? "Saving…" : "Save scenario"}</Button></div>
      </form>
    </Modal>
  );
}

interface Row { id: string; key: string; name: string; attackCategory: string; language: string; deliveryChannel: string; sourceContent: string; userTask: string; context: unknown; expectedPolicyOutcome: string; expectedSafeOutcome: string; severity: string; split: string; tags: string[] }
export function ScenarioRowActions({ s }: { s: Row }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<ScenarioForm>({ ...s, context: JSON.stringify(s.context, null, 2), tags: s.tags.join(", ") });
  const run = useMutation({ mutationFn: async () => { const suite = await api<{ suiteId?: string }>(`/api/benchmarks/scenarios/${s.id}`).then((x) => x as unknown as { suiteId: string }); return api<{ id: string }>("/api/benchmarks/runs", { body: { suiteId: suite.suiteId, scenarioIds: [s.id] } }); }, onSuccess: (r) => { toast.push("ok", "Scenario run queued"); router.push(`/benchmarks/runs/${r.id}`); }, onError: (e) => toast.push("error", e.message) });
  const save = useMutation({ mutationFn: () => { let ctx: unknown; try { ctx = JSON.parse(f.context || "{}"); } catch { throw new Error("Context must be valid JSON"); } return api(`/api/benchmarks/scenarios/${s.id}`, { method: "PATCH", body: { ...f, id: undefined, key: undefined, suiteId: undefined, context: ctx, tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean) } }); }, onSuccess: () => { toast.push("ok", "Scenario updated"); setOpen(false); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const dup = useMutation({ mutationFn: () => api(`/api/benchmarks/scenarios/${s.id}/duplicate`, { body: {} }), onSuccess: () => { toast.push("ok", "Duplicated"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  const del = useMutation({ mutationFn: () => api(`/api/benchmarks/scenarios/${s.id}`, { method: "DELETE" }), onSuccess: () => { toast.push("ok", "Deleted"); router.refresh(); }, onError: (e) => toast.push("error", e.message) });
  return (
    <div className="flex flex-wrap justify-end gap-1"><Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>Run</Button><Button size="sm" onClick={() => setOpen(true)}>Edit</Button><Button size="sm" onClick={() => dup.mutate()}>Duplicate</Button><Button size="sm" variant="danger" onClick={() => { if (window.confirm(`Delete scenario ${s.key}?`)) del.mutate(); }}>Delete</Button>
      <ScenarioModal open={open} onOpenChange={setOpen} value={f} onChange={setF} onSubmit={() => save.mutate()} pending={save.isPending} title={`Edit ${s.key}`} /></div>
  );
}

export function CompareRuns({ runs }: { runs: { id: string; name: string }[] }) {
  const router = useRouter();
  const [a, setA] = useState(runs[1]?.id ?? runs[0]?.id ?? "");
  const [b, setB] = useState(runs[0]?.id ?? "");
  if (runs.length < 2) return <Notice>Run the benchmark at least twice to compare runs.</Notice>;
  return (
    <div className="flex flex-wrap items-end gap-2"><Field label="Run A"><Select value={a} onChange={(e) => setA(e.target.value)} aria-label="Run A">{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field><Field label="Run B"><Select value={b} onChange={(e) => setB(e.target.value)} aria-label="Run B">{runs.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field><Button variant="primary" disabled={a === b} onClick={() => router.push(`/benchmarks/compare?a=${a}&b=${b}`)}>Compare runs</Button></div>
  );
}

export function RunPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
export function TraceButton({ title, trace }: { title: string; trace: unknown }) {
  const [open, setOpen] = useState(false);
  return (<><Button size="sm" onClick={() => setOpen(true)}>Trace</Button><Modal open={open} onOpenChange={setOpen} wide title={`Execution trace — ${title}`}><ol className="space-y-2 text-[12px]">{(trace as { step: string; detail: unknown }[]).map((t, i) => <li key={i} className="rounded border border-border p-2"><b>{i + 1}. {t.step.replace(/_/g, " ")}</b><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-bg p-1.5 text-[11px]">{typeof t.detail === "string" ? t.detail : JSON.stringify(t.detail, null, 2)}</pre></li>)}</ol></Modal></>);
}

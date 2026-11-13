import type { DefenseMetrics } from "@/lib/benchmarks/metrics";
import { Table, Td, Th, pct } from "@/components/ui";

const DEF_LABEL: Record<string, string> = { BASELINE: "A · Unprotected baseline", PROMPT_ONLY: "B · Prompt-only", REGEX: "C · Regex filter", PROXY: "D · PROXY policy + provenance" };
const ROWS: { label: string; hint: string; get: (m: DefenseMetrics) => string }[] = [
  { label: "Samples (attack / benign)", hint: "Executions counted in this column", get: (m) => `${m.n} (${m.attacks} / ${m.benign})${m.errors ? ` · ${m.errors} errors` : ""}` },
  { label: "Attack success rate", hint: "Attack scenarios where an unauthorised action executed (lower is better)", get: (m) => pct(m.attackSuccessRate) },
  { label: "Unauthorized action execution rate", hint: "Attack scenarios in which any action outside the user's plan executed", get: (m) => pct(m.unauthorizedActionRate) },
  { label: "Secret-exfiltration attempts blocked", hint: "Blocked / attempted", get: (m) => (m.secretExfilAttempts ? `${m.secretExfilBlocked} / ${m.secretExfilAttempts}` : "0 attempts") },
  { label: "Injection detection precision", hint: "Detected attacks / all detections", get: (m) => pct(m.precision) },
  { label: "Injection detection recall", hint: "Detected attacks / all attacks", get: (m) => pct(m.recall) },
  { label: "False-positive rate", hint: "Benign sources flagged / benign sources", get: (m) => pct(m.falsePositiveRate) },
  { label: "Benign task completion", hint: "Benign scenarios whose user task completed", get: (m) => pct(m.benignCompletionRate) },
  { label: "Task completion under attack", hint: "Attack scenarios where the user's own task still completed", get: (m) => pct(m.safeCompletionOnAttacks) },
  { label: "Evidence provenance coverage", hint: "Proposed actions that carried source references (PROXY only)", get: (m) => pct(m.provenanceCoverage) },
  { label: "Action audit completeness", hint: "Proposed actions with persisted receipts (PROXY only)", get: (m) => pct(m.auditCompleteness) },
  { label: "Policy outcome match", hint: "Observed policy outcome vs scenario expectation (BLOCK ≈ QUARANTINE)", get: (m) => pct(m.policyOutcomeMatch) },
  { label: "Security latency mean / p95", hint: "Scan + policy evaluation, excluding database I/O", get: (m) => (m.latencyMeanMs == null ? "n/a" : `${m.latencyMeanMs.toFixed(2)} / ${m.latencyP95Ms?.toFixed(2)} ms`) },
  { label: "Search requests per completed task", hint: "Benchmarks use fixtures: no live search is issued", get: (m) => (m.searchRequestsPerCompletedTask == null ? "n/a" : m.searchRequestsPerCompletedTask.toFixed(2)) },
  { label: "Cost per completed task", hint: "Only with a real LLM agent and configured prices", get: (m) => (m.costPerCompletedTask == null ? "n/a (no priced provider usage)" : `$${m.costPerCompletedTask.toFixed(4)}`) },
];

export function MetricsTable({ metrics }: { metrics: Record<string, DefenseMetrics> }) {
  const defs = ["BASELINE", "PROMPT_ONLY", "REGEX", "PROXY"].filter((d) => metrics[d]);
  if (!defs.length) return <p className="text-[13px] text-muted">No results.</p>;
  return (
    <Table>
      <thead><tr><Th>Metric</Th>{defs.map((d) => <Th key={d}>{DEF_LABEL[d]}</Th>)}</tr></thead>
      <tbody>{ROWS.map((r) => <tr key={r.label}><Td title={r.hint}>{r.label}<p className="text-[11px] text-muted">{r.hint}</p></Td>{defs.map((d) => <Td key={d} className="tabular-nums">{r.get(metrics[d])}</Td>)}</tr>)}</tbody>
    </Table>
  );
}
export { DEF_LABEL, ROWS };

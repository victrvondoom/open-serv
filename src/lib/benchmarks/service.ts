import { z } from "zod";
import type { Defense, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { enqueue, QUEUES } from "@/lib/queue";
import { isConfigured } from "@/lib/env";
import { buildCorpus, CORPUS_DISCLAIMER, CORPUS_VERSION } from "./corpus";
import { ALL_DEFENSES, metricsForRun, type RunConfig } from "./runner";
import { computeMetrics, type ResultRow } from "./metrics";

export const SYNTHETIC_SUITE = "PROXY synthetic injection corpus";

export async function ensureSuite(ctx: Ctx, name = SYNTHETIC_SUITE) {
  return prisma.benchmarkSuite.upsert({ where: { workspaceId_name: { workspaceId: ctx.workspaceId, name } }, update: {}, create: { workspaceId: ctx.workspaceId, name, description: CORPUS_DISCLAIMER, version: name === SYNTHETIC_SUITE ? CORPUS_VERSION : "custom-1" } });
}

/** Idempotently loads the labelled synthetic corpus (never touches live supplier evidence). */
export async function loadSyntheticCorpus(ctx: Ctx) {
  const suite = await ensureSuite(ctx);
  const seeds = buildCorpus();
  await prisma.$transaction(async (tx) => {
    for (const s of seeds) await tx.benchmarkScenario.upsert({ where: { suiteId_key: { suiteId: suite.id, key: s.key } }, update: {}, create: { suiteId: suite.id, ...s, context: (s.context ?? {}) as object } });
  });
  await audit(ctx, "benchmark.corpus_loaded", "BenchmarkSuite", suite.id, { scenarios: seeds.length });
  return { suite, count: seeds.length };
}

const scenarioZ = z.object({
  suiteId: z.string().optional(), key: z.string().trim().min(1).max(40).optional(), name: z.string().trim().min(2).max(200), attackCategory: z.string().trim().min(2).max(60), language: z.string().trim().min(2).max(10).default("en"),
  deliveryChannel: z.string().trim().min(2).max(60), sourceContent: z.string().min(1).max(200_000), userTask: z.string().trim().min(5).max(2000),
  context: z.record(z.string(), z.unknown()).default({}), expectedPolicyOutcome: z.enum(["ALLOW", "BLOCK", "REQUIRE_APPROVAL", "QUARANTINE"]), expectedSafeOutcome: z.string().trim().min(2).max(1000),
  severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"), split: z.enum(["DEV", "HOLDOUT"]).default("DEV"), tags: z.array(z.string().max(40)).max(20).default([]),
});

export async function listScenarios(ctx: Ctx, opts: { suiteId?: string; split?: string; category?: string; q?: string; page?: number; pageSize?: number }) {
  const page = Math.max(1, opts.page ?? 1), pageSize = Math.min(200, opts.pageSize ?? 25);
  const where: Prisma.BenchmarkScenarioWhereInput = { suite: { workspaceId: ctx.workspaceId, ...(opts.suiteId ? { id: opts.suiteId } : {}) }, ...(opts.split ? { split: opts.split as never } : {}), ...(opts.category ? { attackCategory: opts.category } : {}), ...(opts.q ? { OR: [{ name: { contains: opts.q, mode: "insensitive" } }, { key: { contains: opts.q, mode: "insensitive" } }] } : {}) };
  const [items, total] = await Promise.all([prisma.benchmarkScenario.findMany({ where, orderBy: { key: "asc" }, skip: (page - 1) * pageSize, take: pageSize }), prisma.benchmarkScenario.count({ where })]);
  return { items, total, page, pageSize };
}

export async function getScenario(ctx: Ctx, id: string) {
  const s = await prisma.benchmarkScenario.findFirst({ where: { id, suite: { workspaceId: ctx.workspaceId } }, include: { suite: true } });
  if (!s) throw notFound("Scenario");
  return s;
}

export async function createScenario(ctx: Ctx, raw: unknown) {
  const p = scenarioZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid scenario", p.error.flatten());
  const suite = p.data.suiteId ? await prisma.benchmarkSuite.findFirst({ where: { id: p.data.suiteId, workspaceId: ctx.workspaceId } }) : await ensureSuite(ctx, "Custom scenarios");
  if (!suite) throw notFound("Suite");
  const key = p.data.key ?? `U-${Date.now().toString(36).toUpperCase()}`;
  const dup = await prisma.benchmarkScenario.findUnique({ where: { suiteId_key: { suiteId: suite.id, key } } });
  if (dup) throw conflict(`Scenario ID ${key} already exists in this suite.`);
  const { suiteId: _s, key: _k, ...rest } = p.data;
  void _s; void _k;
  const s = await prisma.benchmarkScenario.create({ data: { ...rest, suiteId: suite.id, key, context: rest.context as object } });
  await audit(ctx, "benchmark.scenario_created", "BenchmarkScenario", s.id, { key });
  return s;
}
export async function updateScenario(ctx: Ctx, id: string, raw: unknown) {
  const p = scenarioZ.partial().safeParse(raw);
  if (!p.success) throw badRequest("Invalid scenario", p.error.flatten());
  await getScenario(ctx, id);
  const { suiteId: _s, key: _k, context, ...rest } = p.data;
  void _s; void _k;
  const s = await prisma.benchmarkScenario.update({ where: { id }, data: { ...rest, ...(context ? { context: context as object } : {}) } });
  await audit(ctx, "benchmark.scenario_updated", "BenchmarkScenario", id);
  return s;
}
export async function duplicateScenario(ctx: Ctx, id: string) {
  const s = await getScenario(ctx, id);
  const { id: _i, createdAt: _c, updatedAt: _u, suite: _su, ...rest } = s;
  void _i; void _c; void _u; void _su;
  const copy = await prisma.benchmarkScenario.create({ data: { ...rest, key: `${s.key}-copy-${Date.now().toString(36)}`, name: `${s.name} (copy)`, context: rest.context as object } });
  await audit(ctx, "benchmark.scenario_duplicated", "BenchmarkScenario", copy.id, { from: id });
  return copy;
}
export async function deleteScenario(ctx: Ctx, id: string) {
  await getScenario(ctx, id);
  await prisma.benchmarkScenario.delete({ where: { id } });
  await audit(ctx, "benchmark.scenario_deleted", "BenchmarkScenario", id);
}

export async function exportDataset(ctx: Ctx, suiteId: string, format: "json" | "jsonl") {
  const suite = await prisma.benchmarkSuite.findFirst({ where: { id: suiteId, workspaceId: ctx.workspaceId }, include: { scenarios: { orderBy: { key: "asc" } } } });
  if (!suite) throw notFound("Suite");
  const rows = suite.scenarios.map(({ id: _i, suiteId: _s, createdAt: _c, updatedAt: _u, ...r }) => { void _i; void _s; void _c; void _u; return r; });
  const header = { _dataset: suite.name, version: suite.version, synthetic: suite.isSynthetic, exportedAt: new Date().toISOString() };
  return format === "jsonl" ? rows.map((r) => JSON.stringify(r)).join("\n") : JSON.stringify({ ...header, scenarios: rows }, null, 2);
}

export async function importDataset(ctx: Ctx, text: string, suiteName: string) {
  let items: unknown[];
  const t = text.trim();
  try {
    if (t.startsWith("[")) items = JSON.parse(t);
    else if (t.startsWith("{") && !t.includes("\n{")) { const o = JSON.parse(t); items = Array.isArray(o.scenarios) ? o.scenarios : [o]; }
    else items = t.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { throw badRequest(`File is not valid JSON/JSONL: ${(e as Error).message}`); }
  if (!items.length) throw badRequest("No scenarios found in the file.");
  const suite = await ensureSuite(ctx, suiteName.trim() || "Imported scenarios");
  let created = 0, skipped = 0;
  const errors: string[] = [];
  for (const [i, it] of items.entries()) {
    const p = scenarioZ.safeParse({ ...(it as object) });
    if (!p.success) { errors.push(`#${i + 1}: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}`); continue; }
    const key = p.data.key ?? `I-${String(i + 1).padStart(3, "0")}`;
    const exists = await prisma.benchmarkScenario.findUnique({ where: { suiteId_key: { suiteId: suite.id, key } } });
    if (exists) { skipped++; continue; }
    const { suiteId: _s, key: _k, ...rest } = p.data;
    void _s; void _k;
    await prisma.benchmarkScenario.create({ data: { ...rest, suiteId: suite.id, key, context: rest.context as object } });
    created++;
  }
  await audit(ctx, "benchmark.imported", "BenchmarkSuite", suite.id, { created, skipped, errors: errors.length });
  return { suiteId: suite.id, created, skipped, errors };
}

const runZ = z.object({ suiteId: z.string(), name: z.string().trim().max(120).optional(), split: z.enum(["DEV", "HOLDOUT"]).nullish(), scenarioIds: z.array(z.string()).optional(), defenses: z.array(z.enum(["BASELINE", "PROMPT_ONLY", "REGEX", "PROXY"])).min(1).default(["BASELINE", "PROMPT_ONLY", "REGEX", "PROXY"]), agentMode: z.enum(["reference", "llm"]).default("reference") });

export async function createRun(ctx: Ctx, raw: unknown, opts: { enqueue?: boolean } = {}) {
  const p = runZ.safeParse(raw);
  if (!p.success) throw badRequest("Invalid run", p.error.flatten());
  const suite = await prisma.benchmarkSuite.findFirst({ where: { id: p.data.suiteId, workspaceId: ctx.workspaceId } });
  if (!suite) throw notFound("Suite");
  if (p.data.agentMode === "llm" && !isConfigured.openai()) throw badRequest("LLM agent mode needs OPENAI_API_KEY and OPENAI_MODEL to be configured. Use the deterministic reference agent instead.");
  const count = await prisma.benchmarkScenario.count({ where: { suiteId: suite.id, ...(p.data.split ? { split: p.data.split } : {}), ...(p.data.scenarioIds?.length ? { id: { in: p.data.scenarioIds } } : {}) } });
  if (!count) throw badRequest("No scenarios match this run selection.");
  const config: RunConfig = { defenses: p.data.defenses as Defense[], agentMode: p.data.agentMode, model: p.data.agentMode === "llm" ? process.env.OPENAI_MODEL : undefined, scenarioIds: p.data.scenarioIds, note: p.data.agentMode === "reference" ? "Deterministic reference agent (models a naive instruction-following agent). Measures the defense layers, not any specific LLM." : "Real LLM agent with identical tools, task and content for every defense." };
  const run = await prisma.benchmarkRun.create({ data: { workspaceId: ctx.workspaceId, suiteId: suite.id, name: p.data.name || `${suite.name} · ${p.data.defenses.length === 4 ? "all defenses" : p.data.defenses.join("+")} · ${p.data.split ?? "all"}`, split: p.data.split ?? null, datasetVersion: suite.version, config: config as unknown as object, scenarioCount: count } });
  if (opts.enqueue !== false) await enqueue(QUEUES.benchmark, { runId: run.id });
  await audit(ctx, "benchmark.run_created", "BenchmarkRun", run.id, { scenarios: count, defenses: config.defenses });
  return run;
}

export async function getRun(ctx: Ctx, id: string) {
  const run = await prisma.benchmarkRun.findFirst({ where: { id, workspaceId: ctx.workspaceId }, include: { suite: { select: { id: true, name: true, version: true, isSynthetic: true } } } });
  if (!run) throw notFound("Run");
  const results = await prisma.benchmarkResult.findMany({ where: { runId: id }, include: { scenario: { select: { id: true, key: true, name: true, attackCategory: true, split: true, language: true, deliveryChannel: true, expectedPolicyOutcome: true } } }, orderBy: [{ scenario: { key: "asc" } }, { defense: "asc" }] });
  const metrics = computeMetrics(results.map((r) => ({ ...r, expectedPolicyOutcome: r.scenario.expectedPolicyOutcome } as ResultRow)));
  const bySplit: Record<string, Record<string, ReturnType<typeof computeMetrics>[string]>> = {};
  for (const sp of ["DEV", "HOLDOUT"]) { const rows = results.filter((r) => r.scenario.split === sp); if (rows.length) bySplit[sp] = computeMetrics(rows.map((r) => ({ ...r, expectedPolicyOutcome: r.scenario.expectedPolicyOutcome } as ResultRow))); }
  return { run, results, metrics, bySplit };
}

export async function listRuns(ctx: Ctx, limit = 30) {
  return prisma.benchmarkRun.findMany({ where: { workspaceId: ctx.workspaceId }, orderBy: { createdAt: "desc" }, take: limit, include: { suite: { select: { name: true } } } });
}

export { metricsForRun, ALL_DEFENSES, CORPUS_DISCLAIMER, CORPUS_VERSION };

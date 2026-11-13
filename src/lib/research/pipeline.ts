import type { Prisma, ResearchJob, SearchEngine, SourcingProject } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import { env, isConfigured } from "@/lib/env";
import { ApiError, conflict, notConfigured, notFound } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/ratelimit";
import { cancelQueueJob, enqueue, QUEUES } from "@/lib/queue";
import { domainOf, errMessage, haversineKm, normalizeName, pLimit, sha256, canonicalJson, tokens } from "@/lib/util";
import { serpSearch, normalizeOrganic, normalizePlaces, normalizeLocalPack, normalizeReviews, normalizeNews, type NormalizedPlace, type NormalizedOrganic } from "@/lib/providers/serpapi";
import { safeFetch, FetchBlockedError } from "@/lib/fetcher/safe-fetch";
import { extractHtml } from "@/lib/fetcher/html";
import { ingestDocument } from "@/lib/evidence/ingest";
import { reconcileSupplier } from "@/lib/evidence/reconcile";
import { computeRelevance } from "@/lib/evidence/relevance";
import { llmAssistScan, llmExtractClaims, llmSummarizeSupplier } from "@/lib/evidence/llm";
import { runAction } from "@/lib/actions/controller";
import { generateQueries, projectLocationQuery } from "./queries";
import { isDirectoryDomain, mergeCandidates, type Candidate } from "./candidates";
import { initialStages, JobCancelled, StageTracker, throwIfCancelled } from "./stages";

export type ResearchOptions = { includeReviews: boolean; includeNews: boolean; pages: number; maxSuppliers: number };
export const DEFAULT_OPTIONS = (): ResearchOptions => ({ includeReviews: true, includeNews: false, pages: 1, maxSuppliers: env().RESEARCH_MAX_SUPPLIERS });

/* ───────────────────────── job lifecycle (API side) ───────────────────────── */

export async function startResearch(ctx: Ctx, projectId: string, options: Partial<ResearchOptions> = {}): Promise<ResearchJob> {
  const project = await prisma.sourcingProject.findFirst({ where: { id: projectId, workspaceId: ctx.workspaceId } });
  if (!project) throw notFound("Project");
  if (!isConfigured.serpapi()) throw notConfigured("SerpApi", "Live supplier discovery needs SERPAPI_API_KEY. Set it in .env and restart the app and worker. No results are fabricated without it.");
  const running = await prisma.researchJob.count({ where: { projectId, status: { in: ["QUEUED", "RUNNING"] }, kind: "FULL_RESEARCH" } });
  if (running) throw conflict("A research job for this project is already queued or running.");
  await rateLimit(`research:${ctx.workspaceId}`, 10, 3600);
  const opts = { ...DEFAULT_OPTIONS(), ...options };
  const job = await prisma.researchJob.create({ data: { workspaceId: ctx.workspaceId, projectId, kind: "FULL_RESEARCH", stages: initialStages("FULL_RESEARCH") as unknown as object, stats: { options: opts } } });
  return enqueueJob(ctx, job);
}

async function enqueueJob(ctx: Pick<Ctx, "workspaceId" | "userId">, job: ResearchJob): Promise<ResearchJob> {
  try {
    const qid = await enqueue(QUEUES.research, { jobId: job.id });
    await audit(ctx, "research.queued", "ResearchJob", job.id, { kind: job.kind });
    return prisma.researchJob.update({ where: { id: job.id }, data: { queueJobId: qid } });
  } catch (e) {
    await prisma.researchJob.update({ where: { id: job.id }, data: { status: "FAILED", error: `Could not enqueue job: ${errMessage(e)}`, finishedAt: new Date() } });
    throw new ApiError(503, "queue_unavailable", `Could not enqueue the research job: ${errMessage(e)}`);
  }
}

export async function stopJob(ctx: Ctx, jobId: string) {
  const job = await prisma.researchJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspaceId } });
  if (!job) throw notFound("Research job");
  if (job.status !== "QUEUED" && job.status !== "RUNNING") throw conflict(`Job is already ${job.status}.`);
  await prisma.researchJob.update({ where: { id: job.id }, data: { cancelRequested: true, ...(job.status === "QUEUED" ? { status: "CANCELLED", finishedAt: new Date() } : {}) } });
  if (job.queueJobId && job.status === "QUEUED") await cancelQueueJob(job.queue, job.queueJobId);
  await audit(ctx, "research.stop_requested", "ResearchJob", job.id);
  return prisma.researchJob.findUniqueOrThrow({ where: { id: job.id } });
}

export async function retryJob(ctx: Ctx, jobId: string) {
  const job = await prisma.researchJob.findFirst({ where: { id: jobId, workspaceId: ctx.workspaceId } });
  if (!job) throw notFound("Research job");
  if (job.status !== "FAILED" && job.status !== "CANCELLED") throw conflict("Only failed or cancelled jobs can be retried.");
  if (!isConfigured.serpapi()) throw notConfigured("SerpApi", "Set SERPAPI_API_KEY and restart the app and worker.");
  await rateLimit(`research:${ctx.workspaceId}`, 10, 3600);
  const opts = ((job.stats as { options?: ResearchOptions })?.options) ?? DEFAULT_OPTIONS();
  const fresh = await prisma.researchJob.create({ data: { workspaceId: ctx.workspaceId, projectId: job.projectId, kind: job.kind, supplierId: job.supplierId, retryOfId: job.id, stages: initialStages(job.kind) as unknown as object, stats: { options: opts } } });
  return enqueueJob(ctx, fresh);
}

export async function refreshSupplier(ctx: Ctx, supplierId: string, projectId?: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, workspaceId: ctx.workspaceId }, include: { projects: { orderBy: { savedAt: "desc" }, take: 1 } } });
  if (!supplier) throw notFound("Supplier");
  const pid = projectId ?? supplier.projects[0]?.projectId;
  if (!pid) throw conflict("This supplier is not attached to a sourcing project; add it to a project before refreshing.");
  await rateLimit(`research:${ctx.workspaceId}`, 30, 3600);
  const job = await prisma.researchJob.create({ data: { workspaceId: ctx.workspaceId, projectId: pid, kind: "SUPPLIER_REFRESH", supplierId, stages: initialStages("SUPPLIER_REFRESH") as unknown as object, stats: { options: DEFAULT_OPTIONS() } } });
  return enqueueJob(ctx, job);
}

/* ───────────────────────── worker side ───────────────────────── */

export async function runResearchJob(jobId: string) {
  const job = await prisma.researchJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === "CANCELLED" || job.status === "COMPLETED") return;
  await prisma.researchJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: job.startedAt ?? new Date(), attempts: { increment: 1 }, error: null, errorDetail: Prisma_null() } });
  const ctx = { workspaceId: job.workspaceId, userId: "system" };
  const tracker = await StageTracker.load(jobId);
  try {
    await throwIfCancelled(jobId);
    if (job.kind === "FULL_RESEARCH") await runFull(job, tracker);
    else await runRefresh(job, tracker);
    await prisma.researchJob.update({ where: { id: jobId }, data: { status: "COMPLETED", finishedAt: new Date() } });
    await audit(ctx, "research.completed", "ResearchJob", jobId, tracker.currentStats as Record<string, unknown>, { actorType: "SYSTEM", actorId: "worker" });
  } catch (e) {
    if (e instanceof JobCancelled) {
      await prisma.researchJob.update({ where: { id: jobId }, data: { status: "CANCELLED", finishedAt: new Date() } });
      await audit(ctx, "research.cancelled", "ResearchJob", jobId, {}, { actorType: "SYSTEM", actorId: "worker" });
      return;
    }
    const msg = errMessage(e);
    console.error(`[research ${jobId}]`, msg);
    await prisma.researchJob.update({ where: { id: jobId }, data: { status: "FAILED", finishedAt: new Date(), error: msg.slice(0, 1000), errorDetail: { name: e instanceof Error ? e.name : "Error", message: msg.slice(0, 2000), stats: tracker.currentStats } as object } });
    await audit(ctx, "research.failed", "ResearchJob", jobId, { error: msg.slice(0, 300) }, { actorType: "SYSTEM", actorId: "worker" });
  }
}
const Prisma_null = () => undefined as unknown as Prisma.InputJsonValue;

const mapsUrl = (p: { placeId?: string; dataId?: string; name: string }) => p.placeId ? `https://www.google.com/maps/place/?q=place_id:${p.placeId}` : `https://www.google.com/maps/search/${encodeURIComponent(p.name)}`;

async function resolveProjectCoordinates(job: ResearchJob, project: SourcingProject): Promise<SourcingProject> {
  if (project.latitude != null && project.longitude != null) return project;
  try {
    const r = await serpSearch({ workspaceId: job.workspaceId, jobId: job.id, engine: "GOOGLE_MAPS", params: { q: projectLocationQuery(project), type: "search", hl: "en" } });
    const resp = r.response as { place_results?: { gps_coordinates?: { latitude?: number; longitude?: number } }; local_results?: { gps_coordinates?: { latitude?: number; longitude?: number } }[] };
    const g = resp.place_results?.gps_coordinates ?? resp.local_results?.[0]?.gps_coordinates;
    if (g?.latitude != null && g?.longitude != null) return prisma.sourcingProject.update({ where: { id: project.id }, data: { latitude: g.latitude, longitude: g.longitude } });
  } catch (e) {
    console.warn("[research] could not resolve project coordinates:", errMessage(e));
  }
  return project;
}

async function persistResults(workspaceId: string, requestId: string, kind: "ORGANIC" | "LOCAL" | "MAPS", rows: { position: number; title: string; url?: string; snippet?: string; domain?: string | null; data: unknown }[]) {
  if (!rows.length) return [];
  await prisma.searchResult.createMany({
    data: rows.map((r) => ({ workspaceId, requestId, kind, position: r.position, title: r.title.slice(0, 500), url: r.url ?? null, domain: r.domain ?? null, snippet: r.snippet?.slice(0, 2000) ?? null, data: r.data as object, dedupKey: r.url ? (domainOf(r.url) ?? r.url) : normalizeName(r.title) })),
    skipDuplicates: true,
  });
  return prisma.searchResult.findMany({ where: { requestId, kind } });
}

async function runFull(job: ResearchJob, t: StageTracker) {
  const opts = ((job.stats as { options?: ResearchOptions })?.options) ?? DEFAULT_OPTIONS();
  let project = await prisma.sourcingProject.findUniqueOrThrow({ where: { id: job.projectId } });
  const ctx = { workspaceId: job.workspaceId, userId: "system" };
  await prisma.sourcingProject.update({ where: { id: project.id }, data: { status: "RESEARCHING" } });

  // 1. queries
  await t.start("queries");
  project = await resolveProjectCoordinates(job, project);
  const planned = generateQueries(project);
  await t.setStats({ queries: planned.map((q) => ({ engine: q.engine, q: q.q, purpose: q.purpose })), projectCoordinates: project.latitude != null });
  await t.done("queries", planned.length, `${planned.length} queries generated from the project specification`);

  // 2. search
  await t.start("search");
  const places: { place: NormalizedPlace; requestId: string; searchResultId?: string }[] = [];
  const organics: { result: NormalizedOrganic; requestId: string; searchResultId?: string }[] = [];
  const errors: string[] = [];
  let done = 0, credits = 0, cacheHits = 0;
  const runSearch = async (engine: SearchEngine, params: Record<string, unknown>) => {
    await throwIfCancelled(job.id);
    try {
      const res = await serpSearch({ workspaceId: job.workspaceId, jobId: job.id, engine, params });
      if (res.cacheHit) cacheHits++; else credits++;
      if (engine === "GOOGLE") {
        const org = normalizeOrganic(res.response);
        const rows = await persistResults(job.workspaceId, res.requestId, "ORGANIC", org.map((o) => ({ position: o.position, title: o.title, url: o.url, snippet: o.snippet, domain: o.domain, data: o })));
        for (const o of org) organics.push({ result: o, requestId: res.requestId, searchResultId: rows.find((r) => r.position === o.position)?.id });
        const pack = normalizeLocalPack(res.response);
        if (pack.length) {
          const prow = await persistResults(job.workspaceId, res.requestId, "LOCAL", pack.map((p, i) => ({ position: i + 1, title: p.name, url: p.website, snippet: p.address, domain: domainOf(p.website), data: p.raw })));
          pack.forEach((p, i) => places.push({ place: p, requestId: res.requestId, searchResultId: prow.find((r) => r.position === i + 1)?.id }));
        }
        return org.length + pack.length;
      }
      const pl = normalizePlaces(res.response);
      const rows = await persistResults(job.workspaceId, res.requestId, "MAPS", pl.map((p) => ({ position: p.position, title: p.name, url: p.website, snippet: p.address, domain: domainOf(p.website), data: p.raw })));
      for (const p of pl) places.push({ place: p, requestId: res.requestId, searchResultId: rows.find((r) => r.position === p.position)?.id });
      return pl.length;
    } catch (e) {
      if (e instanceof JobCancelled) throw e;
      errors.push(`${engine} "${String(params.q ?? "")}": ${errMessage(e)}`);
      return 0;
    }
  };
  for (const q of planned) {
    for (let page = 0; page < opts.pages; page++) {
      const params = { ...q.params, ...(page ? { start: page * (q.engine === "GOOGLE" ? 10 : 20) } : {}) };
      const n = await runSearch(q.engine, params);
      done++;
      await t.progress("search", done, `${done}/${planned.length * opts.pages} requests · ${credits} credits used · ${cacheHits} cache hits`);
      if (n === 0) break;
    }
  }
  await t.setStats({ searchErrors: errors, creditsUsed: credits, cacheHits });
  if (errors.length === planned.length * opts.pages) throw new Error(`All search requests failed. First error: ${errors[0]}`);
  await t.done("search", done, `${credits} credits used, ${cacheHits} served from cache${errors.length ? `, ${errors.length} failed` : ""}`);

  // 3/4. businesses + dedupe
  await t.start("businesses");
  const { candidates: allCandidates, rawCount, directoryResults } = mergeCandidates(places, organics, project.excludedSuppliers);
  let candidates = allCandidates;
  const center = project.latitude != null && project.longitude != null ? { lat: project.latitude, lng: project.longitude } : null;
  let outside = 0;
  if (center) candidates = candidates.filter((c) => {
    if (c.place?.lat == null || c.place?.lng == null) return true;
    const ok = haversineKm(center, { lat: c.place.lat, lng: c.place.lng }) <= project.maxRadiusKm * 1.1;
    if (!ok) outside++;
    return ok;
  });
  const priority = (c: Candidate) => (c.place && c.domain ? 0 : c.place ? 1 : 2);
  candidates = candidates.sort((a, b) => priority(a) - priority(b)).slice(0, opts.maxSuppliers);
  await t.done("businesses", candidates.length, `${rawCount} raw hits → ${candidates.length} businesses (${directoryResults.length} directory/social results kept as search evidence only${outside ? `, ${outside} outside radius` : ""})`);
  await t.start("dedupe");
  await t.done("dedupe", Math.max(0, rawCount - allCandidates.length), `${Math.max(0, rawCount - allCandidates.length)} duplicate listings merged`);
  await throwIfCancelled(job.id);

  // persist suppliers + search-origin evidence
  const projectTokens = tokens(project.productName);
  const supplierIds: string[] = [];
  for (const c of candidates) {
    await throwIfCancelled(job.id);
    const refs = [...c.placeSources.map((s) => s.requestId), ...c.organic.map((o) => o.requestId)];
    const { result } = await runAction(ctx, { actionType: "CREATE_SUPPLIER_RECORD", actorType: "SYSTEM", actorId: "research-pipeline", params: { name: c.name, domain: c.domain, placeId: c.place?.placeId ?? null, projectId: project.id }, sourceRefs: [...new Set(refs)].map((id) => ({ sourceId: id, kind: "THIRD_PARTY" as const })) }, () => upsertSupplier(job.workspaceId, project, c));
    if (!result) continue;
    supplierIds.push(result.id);
    // link search results
    const resultIds = [...c.placeSources, ...c.organic].map((s) => s.searchResultId).filter((x): x is string => !!x);
    if (resultIds.length) await prisma.searchResult.updateMany({ where: { id: { in: resultIds } }, data: { supplierId: result.id } });
    if (c.place) await ingestPlace(job, result.id, c, projectTokens);
    for (const o of c.organic) await ingestSnippet(job, result.id, o, projectTokens);
  }
  // non-supplier results (directories/social) are still scanned: injection can arrive via any search result
  for (const o of directoryResults) await ingestSnippet(job, null, o, projectTokens);

  // official-website discovery for map-only businesses (bounded)
  const noSite = candidates.filter((c) => c.place && !c.domain).slice(0, 5);
  for (const c of noSite) {
    await throwIfCancelled(job.id);
    try {
      const res = await serpSearch({ workspaceId: job.workspaceId, jobId: job.id, engine: "GOOGLE", params: { q: `"${c.name}" ${project.city}`, location: projectLocationQuery(project), num: 5, hl: "en" } });
      const org = normalizeOrganic(res.response).filter((o) => o.domain && !isDirectoryDomain(o.domain));
      const nt = tokens(c.name);
      const hit = org.find((o) => { const tt = tokens(o.title); const inter = nt.filter((x) => tt.includes(x)).length; return inter / Math.max(1, nt.length) >= 0.6; });
      const supplier = await prisma.supplier.findFirst({ where: { workspaceId: job.workspaceId, mapsPlaceId: c.place!.placeId ?? "__none__" } });
      if (hit && supplier && !supplier.website) {
        await prisma.supplier.update({ where: { id: supplier.id }, data: { website: hit.url, domain: hit.domain } });
        c.domain = hit.domain; c.website = hit.url;
      }
    } catch (e) { if (e instanceof JobCancelled) throw e; errors.push(`official-site search "${c.name}": ${errMessage(e)}`); }
  }

  // 5. fetch websites
  await t.start("fetch");
  const suppliers = await prisma.supplier.findMany({ where: { id: { in: supplierIds } } });
  const fetched = await fetchSupplierSites(job, suppliers, projectTokens, t);
  await t.done("fetch", fetched.ok, `${fetched.ok} pages fetched, ${fetched.failed} failed/blocked across ${fetched.sites} websites`);

  // 6. analyse (reviews / news / AI extraction)
  await t.start("analyse");
  let analysed = fetched.docIds.length;
  const reviewTargets = opts.includeReviews && isConfigured.serpapi() ? suppliers.filter((s) => s.mapsDataId).slice(0, 8) : [];
  for (const s of reviewTargets) {
    await throwIfCancelled(job.id);
    analysed += await fetchReviews(job, s, projectTokens);
    await t.progress("analyse", analysed);
  }
  if (opts.includeNews) for (const s of suppliers.slice(0, 3)) { await throwIfCancelled(job.id); analysed += await fetchNews(job, s, project, projectTokens); }
  let llm = { accepted: 0, rejected: 0, skipped: 0 };
  if (isConfigured.openai()) for (const id of fetched.docIds) {
    await throwIfCancelled(job.id);
    const r = await llmExtractClaims(id, projectTokens);
    llm = { accepted: llm.accepted + r.accepted, rejected: llm.rejected + r.rejectedUnverified, skipped: llm.skipped + r.skippedFlagged };
  }
  await t.setStats({ llmExtraction: isConfigured.openai() ? llm : "disabled (OPENAI not configured)" });
  await t.done("analyse", analysed, `${analysed} sources analysed${isConfigured.openai() ? ` · AI claims accepted ${llm.accepted}, rejected as unverifiable ${llm.rejected}, passages quarantined ${llm.skipped}` : " · deterministic extraction (AI disabled)"}`);

  // 7. evidence: reconcile + relevance
  await t.start("evidence");
  let claimTotal = 0;
  for (const id of supplierIds) {
    await throwIfCancelled(job.id);
    await reconcileSupplier(id);
    const rel = await computeRelevance(id, project);
    await prisma.supplierProject.upsert({ where: { supplierId_projectId: { supplierId: id, projectId: project.id } }, update: { matchScore: rel.score, relevance: rel as unknown as object }, create: { supplierId: id, projectId: project.id, matchScore: rel.score, relevance: rel as unknown as object } });
    claimTotal += await prisma.extractedClaim.count({ where: { supplierId: id } });
  }
  await t.done("evidence", claimTotal, `${claimTotal} claims, each linked to its source passage`);

  // 8. security
  await t.start("security");
  let assist = { checked: 0, added: 0 };
  if (isConfigured.openai()) {
    const docs = await prisma.sourceDocument.findMany({ where: { jobId: job.id }, select: { id: true } });
    for (const d of docs) { const r = await llmAssistScan(d.id); assist = { checked: assist.checked + r.checked, added: assist.added + r.added }; }
  }
  const docCount = await prisma.sourceDocument.count({ where: { OR: [{ jobId: job.id }, { supplierId: { in: supplierIds } }] } });
  const findingCount = await prisma.securityFinding.count({ where: { OR: [{ document: { jobId: job.id } }, { supplierId: { in: supplierIds } }] } });
  await t.done("security", findingCount, `${docCount} sources scanned (visible + hidden text) · ${findingCount} findings${isConfigured.openai() ? ` · LLM-assist checked ${assist.checked}, added ${assist.added}` : ""}`);

  // 9. persist
  await t.start("persist");
  if (isConfigured.openai()) for (const id of supplierIds.slice(0, 10)) await llmSummarizeSupplier(id).catch((e) => errors.push(`summary: ${errMessage(e)}`));
  await prisma.supplier.updateMany({ where: { id: { in: supplierIds } }, data: { lastResearchedAt: new Date() } });
  await prisma.sourcingProject.update({ where: { id: project.id }, data: { status: "RESEARCHED" } });
  await t.setStats({ suppliers: supplierIds.length, rawResults: rawCount, duplicatesRemoved: Math.max(0, rawCount - allCandidates.length), documents: docCount, findings: findingCount, errors });
  await t.done("persist", supplierIds.length, `${supplierIds.length} suppliers saved`);
}

async function runRefresh(job: ResearchJob, t: StageTracker) {
  const project = await prisma.sourcingProject.findUniqueOrThrow({ where: { id: job.projectId } });
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: job.supplierId! } });
  const projectTokens = tokens(project.productName);
  await t.start("fetch");
  const f = await fetchSupplierSites(job, [supplier], projectTokens, t);
  await t.done("fetch", f.ok, `${f.ok} pages fetched, ${f.failed} failed`);
  await t.start("analyse");
  let n = f.docIds.length;
  if (supplier.mapsDataId && isConfigured.serpapi()) n += await fetchReviews(job, supplier, projectTokens);
  if (isConfigured.openai()) for (const id of f.docIds) await llmExtractClaims(id, projectTokens);
  await t.done("analyse", n);
  await t.start("evidence");
  await reconcileSupplier(supplier.id);
  const rel = await computeRelevance(supplier.id, project);
  await prisma.supplierProject.upsert({ where: { supplierId_projectId: { supplierId: supplier.id, projectId: project.id } }, update: { matchScore: rel.score, relevance: rel as unknown as object }, create: { supplierId: supplier.id, projectId: project.id, matchScore: rel.score, relevance: rel as unknown as object } });
  await t.done("evidence", await prisma.extractedClaim.count({ where: { supplierId: supplier.id } }));
  await t.start("security");
  const fc = await prisma.securityFinding.count({ where: { supplierId: supplier.id } });
  await t.done("security", fc, `${fc} findings on this supplier`);
  await t.start("persist");
  await prisma.supplier.update({ where: { id: supplier.id }, data: { lastResearchedAt: new Date() } });
  await t.done("persist", 1);
}

/* ───────────────────────── persistence helpers ───────────────────────── */

export async function upsertSupplier(workspaceId: string, project: Pick<SourcingProject, "id" | "city" | "state" | "country">, c: Candidate) {
  const p = c.place;
  const domain = c.domain;
  const identityKey = p?.placeId ? `place:${p.placeId}` : domain ? `domain:${domain}` : p?.dataId ? `maps:${p.dataId}` : `name:${c.normalizedName}|${normalizeName(project.city)}`;
  const or: Prisma.SupplierWhereInput[] = [{ identityKey }];
  if (p?.placeId) or.push({ mapsPlaceId: p.placeId });
  if (domain) or.push({ domain }, { identityKey: `domain:${domain}` });
  or.push({ normalizedName: c.normalizedName, city: project.city });
  const existing = await prisma.supplier.findFirst({ where: { workspaceId, OR: or }, orderBy: { createdAt: "asc" } });
  const data = {
    name: existing?.name ?? c.name, normalizedName: existing?.normalizedName ?? c.normalizedName,
    category: p?.category ?? existing?.category ?? undefined, website: c.website ?? p?.website ?? existing?.website ?? undefined, domain: domain ?? existing?.domain ?? undefined,
    address: p?.address ?? existing?.address ?? undefined, city: existing?.city ?? project.city, state: existing?.state ?? (project.state || undefined), country: existing?.country ?? project.country,
    latitude: p?.lat ?? existing?.latitude ?? undefined, longitude: p?.lng ?? existing?.longitude ?? undefined, phone: existing?.phone ?? p?.phone ?? undefined,
    rating: p?.rating ?? existing?.rating ?? undefined, reviewCount: p?.reviews ?? existing?.reviewCount ?? undefined, mapsPlaceId: p?.placeId ?? existing?.mapsPlaceId ?? undefined, mapsDataId: p?.dataId ?? existing?.mapsDataId ?? undefined,
    hours: (p?.hours as object | undefined) ?? undefined, description: p?.description ?? existing?.description ?? undefined, mapsInfo: p ? ({ types: p.types, position: p.position, retrievedFrom: "google_maps" } as object) : undefined,
  };
  let supplier;
  try {
    supplier = existing
      ? await prisma.supplier.update({ where: { id: existing.id }, data })
      : await prisma.supplier.create({ data: { ...data, workspaceId, identityKey, name: c.name, normalizedName: c.normalizedName } });
  } catch (e) {
    // concurrent insert of the same identity → fall back to the winner
    const again = await prisma.supplier.findFirst({ where: { workspaceId, identityKey } });
    if (!again) throw e;
    supplier = again;
  }
  const pr = await prisma.sourcingProject.findUnique({ where: { id: project.id }, select: { latitude: true, longitude: true } });
  const distanceKm = pr?.latitude != null && pr.longitude != null && supplier.latitude != null && supplier.longitude != null ? Math.round(haversineKm({ lat: pr.latitude, lng: pr.longitude }, { lat: supplier.latitude, lng: supplier.longitude }) * 10) / 10 : null;
  await prisma.supplierProject.upsert({ where: { supplierId_projectId: { supplierId: supplier.id, projectId: project.id } }, update: { distanceKm }, create: { supplierId: supplier.id, projectId: project.id, distanceKm } });
  return supplier;
}

function renderListing(p: NormalizedPlace): { text: string; fields: { type: "PHONE" | "ADDRESS" | "WEBSITE" | "CATEGORY" | "HOURS"; value: string }[] } {
  const lines: string[] = [`Name: ${p.name}`];
  const fields: { type: "PHONE" | "ADDRESS" | "WEBSITE" | "CATEGORY" | "HOURS"; value: string }[] = [];
  if (p.category) { lines.push(`Category: ${p.category}`); fields.push({ type: "CATEGORY", value: p.category }); }
  if (p.address) { lines.push(`Address: ${p.address}`); fields.push({ type: "ADDRESS", value: p.address }); }
  if (p.phone) { lines.push(`Phone: ${p.phone}`); fields.push({ type: "PHONE", value: p.phone }); }
  if (p.website) { lines.push(`Website: ${p.website}`); fields.push({ type: "WEBSITE", value: p.website }); }
  if (p.rating != null) lines.push(`Rating: ${p.rating}${p.reviews != null ? ` (${p.reviews} reviews)` : ""}`);
  if (p.hours) { const h = typeof p.hours === "string" ? p.hours : JSON.stringify(p.hours); lines.push(`Hours: ${h}`); }
  if (p.description) lines.push(`Description: ${p.description}`);
  return { text: lines.join("\n"), fields };
}

async function ingestPlace(job: ResearchJob, supplierId: string, c: Candidate, projectTokens: string[]) {
  const p = c.place!;
  const src = c.placeSources[0];
  const req = src ? await prisma.searchRequest.findUnique({ where: { id: src.requestId }, select: { providerSearchId: true, requestedAt: true, engine: true } }) : null;
  const { text, fields } = renderListing(p);
  await ingestDocument({
    workspaceId: job.workspaceId, supplierId, jobId: job.id, searchRequestId: src?.requestId, searchResultId: src?.searchResultId, url: mapsUrl(p), sourceType: "MAPS_LISTING", provider: "serpapi:google_maps",
    providerSearchId: req?.providerSearchId, title: p.name, text, contentHash: sha256(canonicalJson(p.raw)), retrievedAt: req?.requestedAt, projectTokens, providerFields: fields,
  });
}

async function ingestSnippet(job: ResearchJob, supplierId: string | null, o: { result: NormalizedOrganic; requestId: string; searchResultId?: string }, projectTokens: string[]) {
  const req = await prisma.searchRequest.findUnique({ where: { id: o.requestId }, select: { providerSearchId: true, requestedAt: true } });
  await ingestDocument({
    workspaceId: job.workspaceId, supplierId, jobId: job.id, searchRequestId: o.requestId, searchResultId: o.searchResultId, url: o.result.url, sourceType: "SEARCH_SNIPPET", provider: "serpapi:google", providerSearchId: req?.providerSearchId,
    title: o.result.title, text: `${o.result.title}\n${o.result.snippet}`.trim(), retrievedAt: req?.requestedAt, projectTokens,
  });
}

const PAGE_HINT = /contact|about|product|catalog|catalogue|company|reach|enquir|inquir|profile/i;

function sameSite(host: string, base: string) { return host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`); }

async function fetchSupplierSites(job: ResearchJob, suppliers: { id: string; website: string | null; domain: string | null }[], projectTokens: string[], t: StageTracker) {
  const limit = pLimit(4);
  let ok = 0, failed = 0, sites = 0;
  const docIds: string[] = [];
  const todo = suppliers.filter((s) => s.website && s.domain);
  await Promise.all(
    todo.map((s) =>
      limit(async () => {
        await throwIfCancelled(job.id);
        sites++;
        const visited = new Set<string>();
        const queue = [s.website!];
        while (queue.length && visited.size < 3) {
          const url = queue.shift()!;
          if (visited.has(url)) continue;
          visited.add(url);
          const r = await fetchAndIngest(job, s.id, url, projectTokens);
          if (r.ok) { ok++; docIds.push(r.docId!); for (const u of r.discovered.filter((x) => !visited.has(x))) if (queue.length + visited.size < 3 && sameSite(domainOf(u) ?? "", s.domain!)) queue.push(u); } else failed++;
          if (!r.ok && visited.size === 1) break; // homepage unreachable → do not hammer
          await t.progress("fetch", ok, `${ok} fetched, ${failed} failed`);
        }
      }),
    ),
  );
  return { ok, failed, sites, docIds };
}

async function fetchAndIngest(job: ResearchJob, supplierId: string, url: string, projectTokens: string[]) {
  try {
    const res = await safeFetch(url);
    const isHtml = /html|xml/.test(res.contentType);
    const page = isHtml ? extractHtml(res.body) : null;
    const text = page ? `${page.title}\n${page.visibleText}`.trim() : res.body;
    const ing = await ingestDocument({
      workspaceId: job.workspaceId, supplierId, jobId: job.id, url, finalUrl: res.finalUrl, sourceType: "WEBSITE_PAGE", provider: "safe-fetch", title: page?.title ?? null, httpStatus: res.status, contentType: res.contentType,
      text, hiddenText: page?.hiddenText ?? null, structured: page ? { headings: page.headings, listItems: page.listItems, jsonLd: page.jsonLd, mailto: page.mailto, tel: page.tel } : null, contentHash: res.contentHash, byteLength: res.bytes, retrievedAt: res.retrievedAt, projectTokens,
      fetchError: res.status >= 400 ? `HTTP ${res.status}` : null,
    });
    const discovered = page ? page.links.map((l) => { try { return { u: new URL(l.href, res.finalUrl).toString(), t: l.text }; } catch { return null; } }).filter((x): x is { u: string; t: string } => !!x && PAGE_HINT.test(`${x.u} ${x.t}`) && /^https?:/.test(x.u)).map((x) => x.u.split("#")[0]) : [];
    return { ok: res.status < 400, docId: ing.documentId, discovered: [...new Set(discovered)].slice(0, 6) };
  } catch (e) {
    const msg = e instanceof FetchBlockedError ? `Blocked: ${e.message}` : errMessage(e);
    await ingestDocument({ workspaceId: job.workspaceId, supplierId, jobId: job.id, url, sourceType: "WEBSITE_PAGE", provider: "safe-fetch", text: "", contentHash: sha256(`fetch-error:${msg}`), fetchError: msg.slice(0, 500), httpStatus: null }).catch(() => undefined);
    return { ok: false, docId: undefined, discovered: [] as string[] };
  }
}

async function fetchReviews(job: ResearchJob, s: { id: string; mapsDataId: string | null; mapsPlaceId: string | null; name: string }, projectTokens: string[]): Promise<number> {
  try {
    const res = await serpSearch({ workspaceId: job.workspaceId, jobId: job.id, engine: "GOOGLE_MAPS_REVIEWS", params: { data_id: s.mapsDataId!, hl: "en", sort_by: "newestFirst" } });
    const reviews = normalizeReviews(res.response).slice(0, 20);
    if (!reviews.length) return 0;
    await prisma.searchResult.createMany({ data: reviews.map((r) => ({ workspaceId: job.workspaceId, requestId: res.requestId, kind: "REVIEW" as const, position: r.position, title: `Review${r.user ? ` by ${r.user}` : ""}`, url: r.link ?? null, snippet: r.snippet.slice(0, 2000), data: r as object, dedupKey: sha256(r.snippet).slice(0, 24), supplierId: s.id })), skipDuplicates: true });
    const text = reviews.map((r) => `${r.rating != null ? `[${r.rating}★] ` : ""}${r.snippet}${r.date ? ` (${r.date})` : ""}`).join("\n\n");
    const avg = reviews.filter((r) => r.rating != null).reduce((a, r) => a + (r.rating ?? 0), 0) / Math.max(1, reviews.filter((r) => r.rating != null).length);
    await prisma.supplier.update({ where: { id: s.id }, data: { reviewsSummary: { sampleSize: reviews.length, averageRating: Math.round(avg * 100) / 100, retrievedAt: new Date().toISOString(), providerSearchId: res.providerSearchId } as object } });
    await ingestDocument({ workspaceId: job.workspaceId, supplierId: s.id, jobId: job.id, searchRequestId: res.requestId, url: `${mapsUrl({ placeId: s.mapsPlaceId ?? undefined, name: s.name })}#reviews`, sourceType: "REVIEW", provider: "serpapi:google_maps_reviews", providerSearchId: res.providerSearchId, title: `Google Maps reviews — ${s.name}`, text, projectTokens });
    return 1;
  } catch (e) {
    if (e instanceof JobCancelled) throw e;
    console.warn("[research] reviews failed:", errMessage(e));
    return 0;
  }
}

async function fetchNews(job: ResearchJob, s: { id: string; name: string }, project: SourcingProject, projectTokens: string[]): Promise<number> {
  try {
    const res = await serpSearch({ workspaceId: job.workspaceId, jobId: job.id, engine: "GOOGLE_NEWS", params: { q: `"${s.name}" ${project.city}`, hl: "en", gl: "in" } });
    const items = normalizeNews(res.response).slice(0, 5);
    let n = 0;
    for (const it of items) { await ingestDocument({ workspaceId: job.workspaceId, supplierId: s.id, jobId: job.id, searchRequestId: res.requestId, url: it.url, sourceType: "NEWS", provider: "serpapi:google_news", providerSearchId: res.providerSearchId, title: it.title, text: `${it.title}\n${it.snippet ?? ""}${it.source ? `\nSource: ${it.source}` : ""}${it.date ? `\nDate: ${it.date}` : ""}`, projectTokens }); n++; }
    return n;
  } catch (e) { if (e instanceof JobCancelled) throw e; return 0; }
}

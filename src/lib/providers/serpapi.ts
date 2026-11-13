import { z } from "zod";
import { prisma } from "@/lib/db";
import { env, isConfigured } from "@/lib/env";
import { ApiError, notConfigured } from "@/lib/errors";
import { canonicalJson, domainOf, errMessage, sha256, sleep } from "@/lib/util";
import { rateLimit } from "@/lib/ratelimit";
import type { SearchEngine } from "@/generated/prisma/client";

/* Documented SerpApi parameters (https://serpapi.com/search-api, /google-maps-api, /google-maps-reviews-api, /google-news-api) */
const googleParams = z.object({
  q: z.string().min(2).max(400),
  location: z.string().max(200).optional(),
  google_domain: z.string().optional(),
  gl: z.string().length(2).optional(),
  hl: z.string().min(2).max(5).optional(),
  num: z.number().int().min(1).max(100).optional(),
  start: z.number().int().min(0).max(200).optional(),
});
const mapsParams = z.object({
  q: z.string().min(2).max(400),
  type: z.literal("search").default("search"),
  ll: z.string().regex(/^@-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+(\.\d+)?z$/).optional(),
  hl: z.string().min(2).max(5).optional(),
  start: z.number().int().min(0).max(400).optional(),
});
const reviewParams = z.object({
  data_id: z.string().min(5).max(200),
  hl: z.string().min(2).max(5).optional(),
  sort_by: z.enum(["qualityScore", "newestFirst", "ratingHigh", "ratingLow"]).optional(),
  next_page_token: z.string().optional(),
});
const newsParams = z.object({
  q: z.string().min(2).max(400),
  gl: z.string().length(2).optional(),
  hl: z.string().min(2).max(5).optional(),
});

const ENGINE_NAME: Record<SearchEngine, string> = {
  GOOGLE: "google",
  GOOGLE_MAPS: "google_maps",
  GOOGLE_MAPS_REVIEWS: "google_maps_reviews",
  GOOGLE_NEWS: "google_news",
};
const SCHEMAS: Record<SearchEngine, z.ZodType<Record<string, unknown>>> = {
  GOOGLE: googleParams,
  GOOGLE_MAPS: mapsParams,
  GOOGLE_MAPS_REVIEWS: reviewParams,
  GOOGLE_NEWS: newsParams,
};

export class SerpApiError extends Error {
  constructor(message: string, public status: number | null, public retryable: boolean) {
    super(message);
  }
}

export interface SerpCallInput {
  workspaceId: string;
  jobId?: string | null;
  engine: SearchEngine;
  params: Record<string, unknown>;
  useCache?: boolean;
}
export interface SerpCallResult {
  requestId: string;
  response: Record<string, unknown>;
  providerSearchId: string | null;
  cacheHit: boolean;
}

function apiKey(): string {
  const k = env().SERPAPI_API_KEY;
  if (!k) throw notConfigured("SerpApi", "Set SERPAPI_API_KEY in your environment (see .env.example) and restart the app and worker.");
  return k;
}

async function httpGet(url: URL, timeoutMs: number): Promise<{ status: number; json: Record<string, unknown> | null; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    const text = await res.text();
    let json: Record<string, unknown> | null = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(t);
  }
}

/** Executes one SerpApi search with validation, caching, rate limiting, retries and request logging. */
export async function serpSearch(input: SerpCallInput): Promise<SerpCallResult> {
  const key = apiKey();
  const params = SCHEMAS[input.engine].parse(input.params);
  const engine = ENGINE_NAME[input.engine];
  const cacheKey = sha256(canonicalJson({ engine, params }));
  const query = String((params as { q?: string; data_id?: string }).q ?? (params as { data_id?: string }).data_id ?? "");

  if (input.useCache !== false && env().SERPAPI_CACHE_TTL_HOURS > 0) {
    const since = new Date(Date.now() - env().SERPAPI_CACHE_TTL_HOURS * 3600_000);
    const hit = await prisma.searchRequest.findFirst({
      where: { workspaceId: input.workspaceId, cacheKey, status: "SUCCEEDED", requestedAt: { gte: since }, cacheHit: false, response: { not: undefined } },
      orderBy: { requestedAt: "desc" },
    });
    if (hit?.response) {
      const row = await prisma.searchRequest.create({
        data: {
          workspaceId: input.workspaceId, jobId: input.jobId ?? null, engine: input.engine, query, params: params as object, cacheKey,
          providerSearchId: hit.providerSearchId, status: "SUCCEEDED", httpStatus: 200, resultCount: hit.resultCount, creditsUsed: 0, cacheHit: true,
          durationMs: 0, response: hit.response as object, completedAt: new Date(),
        },
      });
      return { requestId: row.id, response: hit.response as Record<string, unknown>, providerSearchId: hit.providerSearchId, cacheHit: true };
    }
  }

  const reqRow = await prisma.searchRequest.create({
    data: { workspaceId: input.workspaceId, jobId: input.jobId ?? null, engine: input.engine, query, params: params as object, cacheKey, status: "PENDING" },
  });

  const url = new URL("/search.json", env().SERPAPI_BASE_URL);
  url.searchParams.set("engine", engine);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  url.searchParams.set("api_key", key);

  const started = Date.now();
  let lastErr: SerpApiError | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await waitForSlot(input.workspaceId);
      const { status, json, text } = await httpGet(url, 20_000);
      if (status === 200 && json && !json.error) {
        const resultCount = countResults(input.engine, json);
        const meta = (json.search_metadata ?? {}) as { id?: string };
        await prisma.searchRequest.update({
          where: { id: reqRow.id },
          data: { status: "SUCCEEDED", httpStatus: 200, providerSearchId: meta.id ?? null, resultCount, creditsUsed: 1, durationMs: Date.now() - started, response: json as object, completedAt: new Date() },
        });
        return { requestId: reqRow.id, response: json, providerSearchId: meta.id ?? null, cacheHit: false };
      }
      const msg = redact(String(json?.error ?? text.slice(0, 200) ?? `HTTP ${status}`));
      // SerpApi returns 200 + "hasn't returned any results" for empty searches: not a failure.
      if (status === 200 && /hasn't returned any results|no results/i.test(msg)) {
        await prisma.searchRequest.update({
          where: { id: reqRow.id },
          data: { status: "SUCCEEDED", httpStatus: 200, providerSearchId: ((json?.search_metadata as { id?: string })?.id) ?? null, resultCount: 0, creditsUsed: 1, durationMs: Date.now() - started, response: (json ?? {}) as object, completedAt: new Date() },
        });
        return { requestId: reqRow.id, response: json ?? {}, providerSearchId: null, cacheHit: false };
      }
      lastErr = new SerpApiError(`SerpApi ${status}: ${msg}`, status, status === 429 || status >= 500);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      lastErr = new SerpApiError(`SerpApi request failed: ${redact(errMessage(e))}`, null, true);
    }
    if (!lastErr.retryable || attempt === 3) break;
    await sleep(500 * 2 ** attempt);
  }
  await prisma.searchRequest.update({
    where: { id: reqRow.id },
    data: { status: "FAILED", httpStatus: lastErr?.status ?? null, error: lastErr?.message, durationMs: Date.now() - started, completedAt: new Date() },
  });
  throw lastErr ?? new SerpApiError("SerpApi request failed", null, false);
}

const redact = (s: string) => s.replace(/api_key=[^&\s"]+/gi, "api_key=***");

/** Cross-process request pacing: at most SERPAPI_REQUESTS_PER_MINUTE requests (DB-backed). */
async function waitForSlot(workspaceId: string) {
  const limit = env().SERPAPI_REQUESTS_PER_MINUTE;
  for (let i = 0; i < 70; i++) {
    try {
      await rateLimit(`serpapi:${workspaceId}`, limit, 60);
      return;
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 429) throw e;
      await sleep(1000);
    }
  }
  throw new SerpApiError("Local SerpApi rate limit not released in time", 429, false);
}

function countResults(engine: SearchEngine, j: Record<string, unknown>): number {
  const len = (k: string) => (Array.isArray(j[k]) ? (j[k] as unknown[]).length : 0);
  switch (engine) {
    case "GOOGLE": return len("organic_results") + len("local_results");
    case "GOOGLE_MAPS": return len("local_results") + (j.place_results ? 1 : 0);
    case "GOOGLE_MAPS_REVIEWS": return len("reviews");
    case "GOOGLE_NEWS": return len("news_results");
  }
}

/* ───────── Normalizers ───────── */
export interface NormalizedOrganic { position: number; title: string; url: string; snippet: string; displayedLink?: string; domain: string | null }
export interface NormalizedPlace {
  position: number; placeId?: string; dataId?: string; name: string; address?: string; phone?: string; website?: string;
  rating?: number; reviews?: number; category?: string; types?: string[]; lat?: number; lng?: number; hours?: unknown; description?: string; raw: unknown;
}
export interface NormalizedReview { position: number; rating?: number; snippet: string; date?: string; isoDate?: string; user?: string; link?: string }
export interface NormalizedNews { position: number; title: string; url: string; source?: string; date?: string; snippet?: string }

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function normalizeOrganic(j: Record<string, unknown>): NormalizedOrganic[] {
  const arr = (j.organic_results as Record<string, unknown>[] | undefined) ?? [];
  return arr
    .filter((r) => str(r.link))
    .map((r, i) => ({ position: num(r.position) ?? i + 1, title: str(r.title) ?? str(r.link)!, url: str(r.link)!, snippet: str(r.snippet) ?? "", displayedLink: str(r.displayed_link), domain: domainOf(str(r.link)) }));
}

function placeFrom(r: Record<string, unknown>, i: number): NormalizedPlace | null {
  const name = str(r.title);
  if (!name) return null;
  const gps = (r.gps_coordinates ?? {}) as Record<string, unknown>;
  const types = Array.isArray(r.types) ? (r.types as unknown[]).filter((t): t is string => typeof t === "string") : undefined;
  return {
    position: num(r.position) ?? i + 1, placeId: str(r.place_id), dataId: str(r.data_id), name, address: str(r.address), phone: str(r.phone),
    website: str(r.website), rating: num(r.rating), reviews: num(r.reviews), category: str(r.type) ?? types?.[0], types,
    lat: num(gps.latitude), lng: num(gps.longitude), hours: r.operating_hours ?? r.hours, description: str(r.description) ?? str((r.description as { snippet?: string })?.snippet), raw: r,
  };
}
export function normalizePlaces(j: Record<string, unknown>): NormalizedPlace[] {
  const list = ((j.local_results as Record<string, unknown>[] | undefined) ?? []).map(placeFrom);
  if (j.place_results) list.unshift(placeFrom(j.place_results as Record<string, unknown>, 0));
  return list.filter((p): p is NormalizedPlace => !!p).map((p, i) => ({ ...p, position: i + 1 }));
}
/** Google web results may also carry a local pack. */
export function normalizeLocalPack(j: Record<string, unknown>): NormalizedPlace[] {
  const lr = j.local_results;
  const arr = Array.isArray(lr) ? (lr as Record<string, unknown>[]) : Array.isArray((lr as { places?: unknown[] })?.places) ? ((lr as { places: Record<string, unknown>[] }).places) : [];
  return arr.map(placeFrom).filter((p): p is NormalizedPlace => !!p);
}
export function normalizeReviews(j: Record<string, unknown>): NormalizedReview[] {
  return ((j.reviews as Record<string, unknown>[] | undefined) ?? [])
    .map((r, i) => ({ position: num(r.position) ?? i + 1, rating: num(r.rating), snippet: str(r.snippet) ?? str((r.extracted_snippet as { original?: string })?.original) ?? "", date: str(r.date), isoDate: str(r.iso_date), user: str((r.user as { name?: string })?.name), link: str(r.link) }))
    .filter((r) => r.snippet);
}
export function normalizeNews(j: Record<string, unknown>): NormalizedNews[] {
  return ((j.news_results as Record<string, unknown>[] | undefined) ?? [])
    .filter((r) => str(r.link))
    .map((r, i) => ({ position: i + 1, title: str(r.title) ?? "", url: str(r.link)!, source: str((r.source as { name?: string })?.name), date: str(r.date), snippet: str(r.snippet) }));
}
export function nextReviewsToken(j: Record<string, unknown>): string | undefined {
  return str((j.serpapi_pagination as { next_page_token?: string } | undefined)?.next_page_token);
}

/* ───────── Account / health ───────── */
export interface SerpAccount { ok: boolean; message: string; creditsRemaining?: number; planName?: string; thisMonthUsage?: number; hourlyLimit?: number; raw?: Record<string, unknown> }

/** Real authenticated call to the Account API. Does not consume search credits. */
export async function checkSerpApiAccount(): Promise<SerpAccount> {
  if (!isConfigured.serpapi()) return { ok: false, message: "SERPAPI_API_KEY is not set." };
  try {
    const url = new URL("/account.json", env().SERPAPI_BASE_URL);
    url.searchParams.set("api_key", env().SERPAPI_API_KEY!);
    const { status, json, text } = await httpGet(url, 10_000);
    if (status === 200 && json && !json.error) {
      const left = num(json.total_searches_left);
      return {
        ok: true, message: `Authenticated${json.plan_name ? ` (${json.plan_name})` : ""}`, creditsRemaining: left, planName: str(json.plan_name),
        thisMonthUsage: num(json.this_month_usage), hourlyLimit: num(json.account_rate_limit_per_hour),
        raw: { account_status: json.account_status, plan_name: json.plan_name, plan_searches_left: json.plan_searches_left, extra_credits: json.extra_credits, searches_per_month: json.searches_per_month },
      };
    }
    return { ok: false, message: `SerpApi returned ${status}: ${redact(String(json?.error ?? text.slice(0, 160)))}` };
  } catch (e) {
    return { ok: false, message: `Could not reach SerpApi: ${redact(errMessage(e))}` };
  }
}

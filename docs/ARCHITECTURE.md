# Architecture

```
Browser ── Next.js (RSC pages + REST route handlers) ──┐
                                                         ├─ PostgreSQL (Prisma)  ← single source of truth
Worker (tsx, pg-boss consumer) ──────────────────────────┘     └─ pg-boss queue tables (same DB)
      │
      ├─ SerpApi  (Google / Maps / Maps Reviews / News)       src/lib/providers/serpapi.ts
      ├─ Safe fetcher (public http(s) only)                   src/lib/fetcher/*
      ├─ OpenAI (optional, structured output, validated)      src/lib/providers/openai.ts, src/lib/evidence/llm.ts
      └─ Resend (user-approved RFQ email)                     src/lib/providers/resend.ts
```

## Layers
| Layer | Path | Responsibility |
|---|---|---|
| Pages | `src/app/**/page.tsx` | Server components read through service modules; client islands call the REST API. |
| REST API | `src/app/api/**` | Zod-validated, uniform errors (`src/lib/api/route.ts`), workspace-scoped. |
| Services | `src/lib/{projects,suppliers,rfq,compare,benchmarks,security,evidence}` | Business logic. All queries filter by `workspaceId`. |
| Research pipeline | `src/lib/research/pipeline.ts` | Job stages: queries → search → businesses → dedupe → fetch → analyse → evidence → security → persist. |
| Evidence | `src/lib/evidence/*` | Passage splitting, deterministic extraction, claim↔passage links, reconciliation, relevance. |
| Security | `src/lib/security/*` | Normalisation, rules, scanner. |
| Actions | `src/lib/actions/*` | Deterministic policy, controller (proposal → decision → execution → receipt chain). |
| Benchmarks | `src/lib/benchmarks/*` | Corpus, simulated environment, defenses, metrics. |

## Research job lifecycle
`POST /api/projects/:id/research` creates a `ResearchJob` row (stages JSON initialised) and enqueues `research.run` in pg-boss.
The worker marks it `RUNNING`, updates `stages` after every real step, checks `cancelRequested` between steps, and only sets
`COMPLETED` after the final persist stage. Failures store `error`/`errorDetail`; *Retry* creates a new job linked by `retryOfId`.
Provider calls are logged as `SearchRequest` rows (params without the key, provider `search_metadata.id`, credits, cache hit) and
normalised into `SearchResult` rows with unique `(requestId, kind, position)`.
Caching: a successful identical request within `SERPAPI_CACHE_TTL_HOURS` is replayed from the stored response (0 credits).
Pacing: DB-backed per-minute limiter shared by all workers; retries with exponential back-off on 429/5xx/timeouts.

## Provenance model
```
SearchRequest → SearchResult ─┐
                              ├→ SourceDocument(url, hash, retrievedAt, provider, providerSearchId)
safeFetch(url) ───────────────┘          └→ EvidencePassage(text, offsets, hidden?)
                                                   └→ ClaimEvidence(quote, method) → ExtractedClaim → Supplier*
                                                   └→ SecurityFinding(rule, span, severity, explanation)
```
Every passage exists before a claim cites it; LLM-extracted claims must quote their passage verbatim or they are discarded;
summary bullets without a valid passage reference are dropped. A missing citation is never replaced.

## Action control (source-to-action lineage)
Every action (user, system or agent) is stored as an `ActionProposal` *before* execution with: actor, parameters, source references
(`USER | SYSTEM | THIRD_PARTY | MODEL`), the deterministic policy decision (`ALLOW | BLOCK | REQUIRE_APPROVAL | QUARANTINE`) and reasons.
`ActionExecution` records the outcome; `ActionReceipt` rows form a per-workspace SHA-256 hash chain verified on the Audit page.
`evaluatePolicy` is a pure function with no model in the loop; unknown actions and evaluation errors → `BLOCK`.

## Authentication & workspace isolation
Implemented: **local development mode** — one owner user/workspace is created on first use (`src/lib/context.ts`). All records carry
`workspaceId` and every query filters on it. Bearer session tokens signed with `AUTH_SECRET` (HMAC) select a workspace for API clients.
**Not implemented:** a login UI, password/OAuth flows, invitations and role enforcement. Do not expose a deployment to untrusted users
before adding authentication (replace `getContext`).

## Data model
See `prisma/schema.prisma` (34 models incl. Workspace, User, WorkspaceMember, SourcingProject, ResearchJob, SearchRequest, SearchResult, Supplier,
SupplierProject, SupplierProduct, SupplierContact, SupplierCertification, SourceDocument, EvidencePassage, ExtractedClaim, ClaimEvidence,
SecurityFinding, SecurityReview, SupplierComparison, ComparisonWeight, RFQ, RFQRecipient, RFQApproval, ActionProposal, ActionExecution,
ActionReceipt, BenchmarkSuite/Scenario/Run/Result, AuditEvent, IntegrationStatus, RateLimitBucket). Unique constraints prevent duplicate
supplier identities `(workspaceId, identityKey)`, search results, documents `(workspaceId, url, contentHash)`, claims and findings.
Secrets are never stored in the database.

## Scoring
Ten visible components, each 0–100 with an explanation and evidence links; weights are user-editable and saved per comparison; components without
data are excluded and the weight coverage is shown. The ranking is explicitly a prioritisation aid.

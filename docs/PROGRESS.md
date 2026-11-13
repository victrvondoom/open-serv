# PROGRESS checkpoint

## Completed
* Foundation: Next 16 / Prisma 7 / PostgreSQL schema (34 models) + migrations, env validation, error format, rate limits (DB), audit events.
* Research: SerpApi adapter (Google, Maps, Maps Reviews, News, account), cache, pacing, retries, request log; pg-boss queue + worker; staged job tracking, stop/retry/refresh.
* Safe fetcher (SSRF-safe, DNS pinned, redirects/size/time/type limits) + HTML extraction (hidden-text channel).
* Evidence: passages, deterministic extraction (+ optional LLM with verbatim-quote check), claim↔passage links, reconciliation statuses, relevance.
* Security: scanner (normalisation, decoders, multilingual rules), findings + reviews, synthetic ingest.
* Actions: pure policy, controller, approval, receipt hash chain, research agent, MCP server.
* RFQ: generation, verification, edit, duplicate, .eml, approval bound to content hash, Resend send/retry with persisted response.
* Comparison: 10 explainable components, saved weights, CSV/PDF.
* Benchmarks: scenario CRUD/import/export, synthetic corpus (DEV/HOLDOUT), 4 defenses, metrics from persisted results, run compare.
* UI: all 11 sidebar routes + detail pages; docs (README, ARCHITECTURE, THREAT_MODEL, API, DEPLOYMENT, KNOWN_LIMITATIONS).

## Test status
* Vitest: unit + integration (against PostgreSQL + local provider stubs).
* Playwright: journeys.spec.ts (14 tests) against Next dev + worker + stubs.

## Blockers / notes
* No real SerpApi/OpenAI/Resend credentials or network in the build sandbox → live providers verified only against contract stubs.

## Next step
Run with real keys (Settings → health checks) and review the first live research job.

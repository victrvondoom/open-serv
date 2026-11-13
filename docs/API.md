# REST API

Base path `/api`. JSON in/out. Local mode needs no credentials; API clients may send `Authorization: Bearer <session>` (HMAC token from `signSession`).

**Errors** — always `{ "error": { "code": string, "message": string, "details": any|null } }`.
| Status | Codes |
|---|---|
| 400 | `bad_request`, `validation_error`, `invalid_json` |
| 403 | `forbidden`, `action_blocked`, `action_quarantined` |
| 404 | `not_found` |
| 409 | `conflict`, `integration_not_configured`, `approval_required`, `manual_confirmation_required` |
| 429 | `rate_limited` (with `Retry-After`) |
| 500 | `internal_error` (reference id; stack stays in server logs) |
| 503 | `queue_unavailable` |

Paginated lists: `?page=&pageSize=` → `{ items, total, page, pageSize }`.

| Area | Endpoints |
|---|---|
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id`, `POST /projects/:id/duplicate` |
| Research | `POST /projects/:id/research` (`{includeReviews,includeNews,pages,maxSuppliers}`) → job; `GET /projects/:id/research`; `GET /research-jobs/:id` (stages, provider requests); `POST /research-jobs/:id/stop`; `POST /research-jobs/:id/retry`; `POST /suppliers/:id/refresh` |
| Suppliers | `GET /suppliers` (`q,location,category,projectId,evidence,security,conflicts,tag,sort=recent|match|distance|name`), `POST /suppliers`, `GET/PATCH/DELETE /suppliers/:id`, `POST/DELETE /suppliers/:id/projects`, `POST /suppliers/:id/contacts`, `POST /suppliers/:id/claims/:claimId/confirm` |
| Evidence | `GET /evidence` (`q,supplierId,projectId,sourceType,from,to,threat,hidden`; `view=conflicts`), `GET /sources/:id`, `PATCH /claims/:id` (`REVIEWED|INCORRECT|UNREVIEWED`), `POST /sources/ingest` |
| Comparison | `POST /comparisons/preview`, `GET/POST /comparisons`, `GET/PATCH(weights)/DELETE /comparisons/:id`, `GET /comparisons/:id/export?format=csv|pdf` |
| RFQ | `GET/POST /rfqs`, `GET/PATCH/DELETE /rfqs/:id`, `POST /rfqs/:id/duplicate|verify|approve|send` (`send` body `{recipientIds?,retry?}`), `GET /rfqs/:id/export?recipientId=` (.eml) |
| Security | `GET /security/findings`, `GET /security/findings/:id`, `POST /security/findings/:id/reviews` (`REVIEWED|CONFIRMED|DISMISSED|FALSE_POSITIVE`) |
| Agent / actions | `POST /agent/run` (`{supplierId,projectId?}`), `POST /agent/propose` (always actor AGENT; 201 executed, 202 approval required, 403 blocked/quarantined), `GET /actions`, `POST /actions/:id/approve` |
| Benchmarks | `GET/POST /benchmarks/suites` (POST loads the labelled synthetic corpus), `GET/POST /benchmarks/scenarios`, `GET/PATCH/DELETE /benchmarks/scenarios/:id`, `POST …/duplicate`, `POST /benchmarks/import`, `GET /benchmarks/export?suiteId=&format=json|jsonl`, `GET/POST /benchmarks/runs`, `GET /benchmarks/runs/:id` |
| Platform | `GET/POST /integrations/health` (POST performs live checks), `GET /audit`, `GET /dashboard` |

Rate limits (per workspace, DB-backed): research 10/h, supplier refresh 30/h, benchmark runs 20/h, RFQ sends 30/h, agent runs 30/min, health checks 20/min, SerpApi `SERPAPI_REQUESTS_PER_MINUTE`.

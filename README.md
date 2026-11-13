# PROXY — Live Supplier Intelligence & RFQ Security Platform

PROXY helps industrial procurement teams discover suppliers with live search, trace every supplier claim to the
source that supports it, detect hostile content in search-origin data, and prepare RFQs that a human explicitly
approves before anything leaves the system.

* **Live discovery** — SerpApi Google Search, Google Maps, Maps Reviews (and optional News) → deduplicated suppliers.
* **Evidence provenance** — every phone/email/address/certification is a claim linked to the exact stored passage, source URL, retrieval time and SHA-256.
* **Reconciliation** — corroborated / conflicting / uncorroborated / insufficient / manually confirmed. Conflicts are never presented as fraud.
* **Search-origin security** — deterministic, explainable injection rules (multilingual, obfuscation-aware); an action controller that fails closed.
* **RFQ workspace** — draft from the project spec, verify recipients, `.eml` export, explicit approval, Resend delivery with persisted provider response.
* **Benchmark Lab** — reproducible baseline vs prompt-only vs regex vs PROXY comparison inside a simulated action environment.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind v4 · Radix · TanStack Query · Recharts · PostgreSQL · Prisma 7 · pg-boss · Zod · Vitest · Playwright.

## What needs which credential

| Feature | Needs | Without it |
|---|---|---|
| Everything (projects, suppliers, evidence UI, security, benchmarks with the reference agent, RFQ drafting/export) | PostgreSQL | app cannot start |
| **Live supplier discovery** | `SERPAPI_API_KEY` | Research is disabled with a setup-required banner. Nothing is fabricated. |
| AI-assisted extraction/summaries, LLM benchmark agent | `OPENAI_API_KEY` + `OPENAI_MODEL` | Deterministic extraction is used. |
| Sending RFQ email | `RESEND_API_KEY` + `RESEND_FROM_EMAIL` | Export as `.eml` instead. |

## Quick start

Requirements: Node ≥ 22, PostgreSQL 16 (Docker Compose provided).

```bash
git clone <this-repo> proxy && cd proxy
cp .env.example .env            # then edit: AUTH_SECRET, SERPAPI_API_KEY, ...
docker compose up -d db         # PostgreSQL on :5432 (user/pass/db = proxy)
npm ci
npx prisma migrate deploy       # apply migrations (also generates the client via postinstall/build)
npx prisma generate
```

Run the app and the background worker (two processes):

```bash
npm run dev       # http://localhost:3000
npm run worker    # research + benchmark jobs (pg-boss). Required for research to progress.
```

Production build:

```bash
npm run build && npm start
npm run worker
```

Open **Settings** and press *Run health checks* — each check is a real authenticated request (SerpApi account
endpoint with remaining credits, OpenAI model lookup, Resend key check, worker heartbeat).

### First use
1. *Projects → New project*: Product `stainless steel pipe`, City `Chennai` (any location works), a description, specs, certifications.
2. *Research* → **Start research**. The job runs in the worker; leave the page if you like.
3. *Suppliers* → open one → *Contacts & consistency* → expand *Supporting evidence* → open the original source.
4. *Security* shows flagged passages; *Compare* ranks suppliers with visible components; *RFQs* drafts, approves and sends.
5. *Benchmark Lab* → *Load synthetic corpus* → *Run benchmark*.

## Tests

```bash
npm run typecheck && npm run lint
npm test                 # Vitest unit + integration (needs PostgreSQL; uses database proxy_test)
npm run test:e2e         # Playwright (needs a Chromium; uses database proxy_e2e)
```

Create the test databases once: `createdb proxy_test && createdb proxy_e2e` (user `proxy`).
If Playwright cannot find its browser set `PW_CHROMIUM_PATH=/path/to/chromium`.

**Important:** automated tests never call the real SerpApi / OpenAI / Resend. `tests/fixtures/stubs.ts`
provides local servers that implement the documented request/response contracts (and a few local "supplier websites")
so the real integration code — authentication, parameters, retries, parsing, persistence — is exercised end to end.
The stubs are test-only and are not part of the running product. Live calls to the real providers must be verified
with your own keys (see *Known limitations*).

## Environment

See `.env.example`. Secrets are read server-side only; no API returns them and none reach the browser bundle.
`FETCH_ALLOW_PRIVATE_FOR_TESTS` and `FETCH_TEST_HOST_MAP` exist solely for the test suite and are ignored when `NODE_ENV=production`.

## Documentation
* `docs/ARCHITECTURE.md` — components, data flow, authentication, data model.
* `docs/THREAT_MODEL.md` — assets, trust boundaries, mitigations, residual risk.
* `docs/API.md` — REST endpoints, error format, status codes.
* `docs/DEPLOYMENT.md` — production deployment.
* `docs/KNOWN_LIMITATIONS.md` — what is not done or not verified.
* `docs/PROGRESS.md` — engineering checkpoint.

## Optional: MCP server
`npm run mcp` starts a stdio MCP server exposing read-only supplier/evidence tools, a text scanner and an action-proposal
tool that always goes through the policy engine (agents can never approve or send).

# Deployment

1. **Database** — PostgreSQL 16+. Set `DATABASE_URL`. Run `npx prisma migrate deploy` on every release.
2. **Secrets** — `AUTH_SECRET` (≥32 random chars), `SERPAPI_API_KEY`, optional `OPENAI_*`, `RESEND_*`. Inject via your platform's secret store; never commit `.env`.
3. **Processes** — two long-running processes from the same build:
   * web: `npm run build && npm start` (port 3000, set `APP_BASE_URL`)
   * worker: `npm run worker` (must run in the same network as the database; scale `localConcurrency` in `worker/index.ts` if needed)
   Both need outbound HTTPS to serpapi.com, api.openai.com, api.resend.com and arbitrary public supplier sites.
4. **Do not** set `FETCH_ALLOW_PRIVATE_FOR_TESTS`/`FETCH_TEST_HOST_MAP` (ignored in production anyway).
5. **Network hygiene** — run the worker with egress rules that block RFC1918 and metadata ranges as defence in depth; PROXY already validates every resolved address.
6. **Authentication** — local mode has no login. Place the app behind an authenticating reverse proxy / SSO and replace `getContext` before any multi-user use.
7. **Backups** — the database is the only state (jobs, evidence, receipts).
8. **Health** — Settings → *Run health checks*; the worker writes a heartbeat every 30 s.

Docker Compose provides PostgreSQL only (`docker compose up -d db`); the app is a plain Node process.

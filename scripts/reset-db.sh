#!/usr/bin/env bash
# Dev helper: drop & recreate the local database (destroys data!), then apply migrations.
set -euo pipefail
DB_URL="${DATABASE_URL:-postgresql://proxy:proxy@localhost:5432/proxy}"
npx prisma migrate reset --force --skip-seed

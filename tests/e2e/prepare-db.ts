import pg from "pg";
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL!;
execSync("npx prisma migrate deploy", { env: process.env, stdio: "pipe" });
const c = new pg.Client({ connectionString: url });
c.connect()
  .then(async () => {
    const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\\_prisma%'");
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await c.query("DROP SCHEMA IF EXISTS pgboss CASCADE");
  })
  .then(() => c.end());

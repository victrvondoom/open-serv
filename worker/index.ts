import "dotenv/config";
import { PgBoss } from "pg-boss";
import { prisma } from "../src/lib/db";
import { ensureQueues, QUEUES } from "../src/lib/queue";
import { runResearchJob } from "../src/lib/research/pipeline";
import { runBenchmarkRun } from "../src/lib/benchmarks/runner";

async function main() {
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: true, schedule: false });
  boss.on("error", (e) => console.error("[pg-boss]", e.message));
  await boss.start();
  await ensureQueues(boss);

  await boss.work<{ jobId: string }>(QUEUES.research, { localConcurrency: 2, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const j of jobs) {
      console.log(`[worker] research job ${j.data.jobId}`);
      await runResearchJob(j.data.jobId);
    }
  });
  await boss.work<{ runId: string }>(QUEUES.benchmark, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async (jobs) => {
    for (const j of jobs) {
      console.log(`[worker] benchmark run ${j.data.runId}`);
      await runBenchmarkRun(j.data.runId);
    }
  });

  // Heartbeat so the Settings page can show real worker status.
  const beat = async () => {
    const ws = await prisma.workspace.findMany({ select: { id: true } });
    for (const w of ws)
      await prisma.integrationStatus.upsert({
        where: { workspaceId_provider: { workspaceId: w.id, provider: "worker" } },
        update: { status: "OK", message: "Worker heartbeat", checkedAt: new Date() },
        create: { workspaceId: w.id, provider: "worker", status: "OK", message: "Worker heartbeat" },
      });
  };
  await beat().catch((e) => console.error("[heartbeat]", e.message));
  setInterval(() => beat().catch((e) => console.error("[heartbeat]", e.message)), 30_000);

  // Recover jobs left RUNNING by a crashed worker: pg-boss will redeliver; mark stale ones queued state visible.
  console.log("[worker] ready — queues:", Object.values(QUEUES).join(", "));
  const stop = async () => { await boss.stop({ graceful: true, timeout: 15000 }); await prisma.$disconnect(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((e) => { console.error(e); process.exit(1); });

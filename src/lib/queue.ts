import { PgBoss } from "pg-boss";

export const QUEUES = { research: "research.run", benchmark: "benchmark.run" } as const;

const g = globalThis as unknown as { __boss?: Promise<PgBoss> };

/** Shared pg-boss instance for enqueueing (API) — the worker process uses startWorkerBoss(). */
export function getBoss(): Promise<PgBoss> {
  if (!g.__boss) {
    g.__boss = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL!, supervise: false, schedule: false });
      boss.on("error", (e) => console.error("[pg-boss]", e.message));
      await boss.start();
      await ensureQueues(boss);
      return boss;
    })().catch((e) => {
      g.__boss = undefined;
      throw e;
    });
  }
  return g.__boss;
}

export async function ensureQueues(boss: PgBoss) {
  await boss.createQueue(QUEUES.research, { retryLimit: 2, retryDelay: 15, retryBackoff: true, expireInSeconds: 3600 });
  await boss.createQueue(QUEUES.benchmark, { retryLimit: 1, retryDelay: 10, expireInSeconds: 3600 });
}

export async function enqueue(queue: string, data: object, opts: { singletonKey?: string } = {}): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(queue, data, opts);
}

export async function cancelQueueJob(queue: string, id: string) {
  const boss = await getBoss();
  await boss.cancel(queue, id).catch(() => undefined);
}

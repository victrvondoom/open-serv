import { prisma } from "@/lib/db";

export type StageStatus = "pending" | "running" | "done" | "skipped" | "failed";
export interface StageRecord { key: string; label: string; status: StageStatus; count?: number; detail?: string; startedAt?: string; finishedAt?: string }

export const FULL_STAGES: Omit<StageRecord, "status">[] = [
  { key: "created", label: "Job created" },
  { key: "queries", label: "Search queries submitted" },
  { key: "search", label: "Search provider requests completed" },
  { key: "businesses", label: "Businesses identified" },
  { key: "dedupe", label: "Duplicate businesses removed" },
  { key: "fetch", label: "Websites fetched" },
  { key: "analyse", label: "Sources analysed" },
  { key: "evidence", label: "Evidence extracted" },
  { key: "security", label: "Security checks completed" },
  { key: "persist", label: "Final results persisted" },
];
export const REFRESH_STAGES: Omit<StageRecord, "status">[] = [
  { key: "created", label: "Refresh created" },
  { key: "fetch", label: "Supplier pages fetched" },
  { key: "analyse", label: "Sources analysed" },
  { key: "evidence", label: "Evidence extracted" },
  { key: "security", label: "Security checks completed" },
  { key: "persist", label: "Final results persisted" },
];

export const initialStages = (kind: "FULL_RESEARCH" | "SUPPLIER_REFRESH"): StageRecord[] =>
  (kind === "FULL_RESEARCH" ? FULL_STAGES : REFRESH_STAGES).map((s) => ({ ...s, status: s.key === "created" ? "done" : "pending", finishedAt: s.key === "created" ? new Date().toISOString() : undefined }));

/** Persists real progress to the job row after every stage change. */
export class StageTracker {
  constructor(private jobId: string, private stages: StageRecord[], private stats: Record<string, unknown>) {}

  static async load(jobId: string) {
    const j = await prisma.researchJob.findUniqueOrThrow({ where: { id: jobId } });
    return new StageTracker(jobId, j.stages as unknown as StageRecord[], (j.stats ?? {}) as Record<string, unknown>);
  }
  private find(key: string) { return this.stages.find((s) => s.key === key); }
  private async save() {
    await prisma.researchJob.update({ where: { id: this.jobId }, data: { stages: this.stages as unknown as object, stats: this.stats as object } });
  }
  async start(key: string, detail?: string) {
    const s = this.find(key); if (!s) return;
    s.status = "running"; s.startedAt = new Date().toISOString(); if (detail) s.detail = detail;
    await this.save();
  }
  async progress(key: string, count: number, detail?: string) {
    const s = this.find(key); if (!s) return;
    s.count = count; if (detail) s.detail = detail;
    await this.save();
  }
  async done(key: string, count?: number, detail?: string) {
    const s = this.find(key); if (!s) return;
    s.status = "done"; s.finishedAt = new Date().toISOString(); if (count !== undefined) s.count = count; if (detail) s.detail = detail;
    await this.save();
  }
  async skip(key: string, detail: string) {
    const s = this.find(key); if (!s) return;
    s.status = "skipped"; s.detail = detail; s.finishedAt = new Date().toISOString();
    await this.save();
  }
  async fail(key: string, detail: string) {
    const s = this.find(key); if (!s) return;
    s.status = "failed"; s.detail = detail; s.finishedAt = new Date().toISOString();
    await this.save();
  }
  async setStats(patch: Record<string, unknown>) { Object.assign(this.stats, patch); await this.save(); }
  get currentStats() { return this.stats; }
}

export class JobCancelled extends Error { constructor() { super("Job cancelled by user"); } }

export async function throwIfCancelled(jobId: string) {
  const j = await prisma.researchJob.findUnique({ where: { id: jobId }, select: { cancelRequested: true, status: true } });
  if (!j || j.cancelRequested || j.status === "CANCELLED") throw new JobCancelled();
}

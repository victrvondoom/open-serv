import { prisma } from "@/lib/db";
import { env, isConfigured } from "@/lib/env";
import { checkSerpApiAccount } from "./serpapi";
import { checkOpenAI } from "./openai";
import { checkResend } from "./resend";
import { errMessage } from "@/lib/util";
import type { IntegrationState } from "@/generated/prisma/client";

export interface IntegrationReport {
  provider: string; label: string; status: IntegrationState; message: string; creditsRemaining?: number | null; checkedAt: Date | null;
  configured: boolean; setupHint: string; details?: unknown;
}

const HINTS = {
  database: "Set DATABASE_URL to a reachable PostgreSQL instance and run `npm run db:deploy`.",
  serpapi: "Set SERPAPI_API_KEY (https://serpapi.com/manage-api-key) in .env and restart the app and worker.",
  openai: "Set OPENAI_API_KEY and OPENAI_MODEL in .env. Optional: deterministic extraction works without it.",
  resend: "Set RESEND_API_KEY and RESEND_FROM_EMAIL (verified sender). Optional: .eml export works without it.",
  queue: "The background worker (`npm run worker`) must be running to process research jobs.",
};

/** Runs real connectivity checks and persists the outcome. Status is never inferred from env presence alone. */
export async function runHealthChecks(workspaceId: string): Promise<IntegrationReport[]> {
  const out: IntegrationReport[] = [];
  const save = async (r: Omit<IntegrationReport, "checkedAt">) => {
    const row = await prisma.integrationStatus.upsert({
      where: { workspaceId_provider: { workspaceId, provider: r.provider } },
      update: { status: r.status, message: r.message, creditsRemaining: r.creditsRemaining ?? null, details: (r.details ?? null) as object, checkedAt: new Date() },
      create: { workspaceId, provider: r.provider, status: r.status, message: r.message, creditsRemaining: r.creditsRemaining ?? null, details: (r.details ?? null) as object },
    });
    out.push({ ...r, checkedAt: row.checkedAt });
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    await save({ provider: "database", label: "PostgreSQL", status: "OK", message: "Connected", configured: true, setupHint: HINTS.database });
  } catch (e) {
    await save({ provider: "database", label: "PostgreSQL", status: "ERROR", message: errMessage(e), configured: true, setupHint: HINTS.database }).catch(() => out.push({ provider: "database", label: "PostgreSQL", status: "ERROR", message: errMessage(e), configured: true, setupHint: HINTS.database, checkedAt: new Date() }));
  }

  if (!isConfigured.serpapi()) await save({ provider: "serpapi", label: "SerpApi (live search)", status: "NOT_CONFIGURED", message: "SERPAPI_API_KEY is not set. Live supplier discovery is unavailable.", configured: false, setupHint: HINTS.serpapi });
  else {
    const a = await checkSerpApiAccount();
    await save({ provider: "serpapi", label: "SerpApi (live search)", status: a.ok ? "OK" : "ERROR", message: a.message, creditsRemaining: a.creditsRemaining ?? null, configured: true, setupHint: HINTS.serpapi, details: { plan: a.planName, thisMonthUsage: a.thisMonthUsage, hourlyLimit: a.hourlyLimit, ...a.raw } });
  }

  if (!isConfigured.openai()) await save({ provider: "openai", label: "OpenAI (AI extraction)", status: "NOT_CONFIGURED", message: "Not configured. Deterministic extraction is used; AI-assisted extraction and synthesis are disabled.", configured: false, setupHint: HINTS.openai });
  else {
    const a = await checkOpenAI();
    await save({ provider: "openai", label: "OpenAI (AI extraction)", status: a.ok ? "OK" : "ERROR", message: a.message, configured: true, setupHint: HINTS.openai, details: { model: env().OPENAI_MODEL } });
  }

  if (!isConfigured.resend()) await save({ provider: "resend", label: "Resend (outbound RFQ email)", status: "NOT_CONFIGURED", message: "Not configured. RFQs can be exported as .eml but not sent.", configured: false, setupHint: HINTS.resend });
  else {
    const a = await checkResend();
    await save({ provider: "resend", label: "Resend (outbound RFQ email)", status: a.ok ? "OK" : "ERROR", message: a.message, configured: true, setupHint: HINTS.resend, details: { from: env().RESEND_FROM_EMAIL } });
  }

  // Queue/worker: real signal = pg-boss schema present and a worker heartbeat in the last 2 minutes
  try {
    const hb = await prisma.integrationStatus.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "worker" } } });
    const fresh = hb && Date.now() - hb.checkedAt.getTime() < 120_000 && hb.status === "OK";
    await save({ provider: "worker", label: "Background worker (pg-boss)", status: fresh ? "OK" : "ERROR", message: fresh ? "Worker heartbeat received recently" : "No recent worker heartbeat. Research jobs will stay queued until `npm run worker` is running.", configured: true, setupHint: HINTS.queue, details: { lastHeartbeat: hb?.checkedAt ?? null } });
  } catch (e) {
    await save({ provider: "worker", label: "Background worker (pg-boss)", status: "ERROR", message: errMessage(e), configured: true, setupHint: HINTS.queue });
  }
  return out;
}

export async function readCachedHealth(workspaceId: string): Promise<IntegrationReport[]> {
  const rows = await prisma.integrationStatus.findMany({ where: { workspaceId } });
  return rows.map((r) => ({
    provider: r.provider, label: r.provider, status: r.status, message: r.message ?? "", creditsRemaining: r.creditsRemaining, checkedAt: r.checkedAt,
    configured: r.status !== "NOT_CONFIGURED", setupHint: (HINTS as Record<string, string>)[r.provider] ?? "", details: r.details,
  }));
}

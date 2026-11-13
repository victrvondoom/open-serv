import { prisma } from "@/lib/db";
import { getLocalContext } from "@/lib/context";
import { resetEnvCache } from "@/lib/env";
import { startStubs, STUB_OPENAI_KEY, STUB_RESEND_KEY, STUB_SERP_KEY, type Stubs } from "./fixtures/stubs";

export async function resetDb() {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE '\_prisma%'`;
  if (rows.length) await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function useStubs(opts: { openai?: boolean; resend?: boolean; serp?: boolean } = { serp: true, resend: true }): Promise<Stubs> {
  const s = await startStubs();
  if (opts.serp !== false) { process.env.SERPAPI_API_KEY = STUB_SERP_KEY; process.env.SERPAPI_BASE_URL = s.serpUrl; }
  if (opts.resend !== false) { process.env.RESEND_API_KEY = STUB_RESEND_KEY; process.env.RESEND_FROM_EMAIL = "Procurement <rfq@proxy-test.example>"; process.env.RESEND_BASE_URL = s.resendUrl; }
  if (opts.openai) { process.env.OPENAI_API_KEY = STUB_OPENAI_KEY; process.env.OPENAI_MODEL = "stub-model"; process.env.OPENAI_BASE_URL = s.openaiUrl; }
  process.env.FETCH_ALLOW_PRIVATE_FOR_TESTS = "1";
  process.env.FETCH_TEST_HOST_MAP = s.hostMap;
  process.env.SERPAPI_CACHE_TTL_HOURS = "0";
  resetEnvCache();
  return s;
}

export function clearIntegrationEnv() {
  for (const k of ["SERPAPI_API_KEY", "SERPAPI_BASE_URL", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_BASE_URL", "OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_BASE_URL", "FETCH_ALLOW_PRIVATE_FOR_TESTS", "FETCH_TEST_HOST_MAP", "SERPAPI_CACHE_TTL_HOURS"]) delete process.env[k];
  resetEnvCache();
}

export async function ctx() { return getLocalContext(); }

export async function makeProject(c: Awaited<ReturnType<typeof ctx>>, over: Record<string, unknown> = {}) {
  const { createProject } = await import("@/lib/projects");
  return createProject(c, { name: "Pipes Chennai", productName: "stainless steel pipe", description: "Seamless stainless steel pipes for process plant piping", specifications: "ASTM A312\nOD 60.3 mm", materialGrade: "316L", quantity: 500, unit: "pcs", city: "Chennai", state: "Tamil Nadu", country: "India", maxRadiusKm: 100, requiredCertifications: "ISO 9001", ...over });
}

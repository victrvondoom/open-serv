import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { clearIntegrationEnv, ctx, makeProject, resetDb, useStubs } from "../helpers";
import type { Stubs } from "../fixtures/stubs";
import { runResearchJob, startResearch } from "@/lib/research/pipeline";
import { getSupplierDetail } from "@/lib/suppliers";

let stubs: Stubs;
let jobId: string;
let projectId: string;

beforeAll(async () => {
  await resetDb();
  stubs = await useStubs();
  const c = await ctx();
  const p = await makeProject(c);
  projectId = p.id;
  const job = await startResearch(c, p.id);
  jobId = job.id;
  await runResearchJob(job.id);
});
afterAll(async () => { await stubs.close(); clearIntegrationEnv(); });

describe("live supplier discovery (SerpApi contract stub)", () => {
  it("contacts SerpApi with documented engines and completes the job", async () => {
    const job = await prisma.researchJob.findUniqueOrThrow({ where: { id: jobId } });
    expect(job.status).toBe("COMPLETED");
    const engines = new Set(stubs.serpCalls.map((c) => c.engine));
    expect(engines.has("google")).toBe(true);
    expect(engines.has("google_maps")).toBe(true);
    expect(engines.has("google_maps_reviews")).toBe(true);
    const stages = job.stages as { key: string; status: string }[];
    expect(stages.every((s) => s.status === "done" || s.status === "skipped")).toBe(true);
  });

  it("logs every provider request with its search id", async () => {
    const reqs = await prisma.searchRequest.findMany({ where: { jobId } });
    expect(reqs.length).toBeGreaterThanOrEqual(5);
    expect(reqs.every((r) => r.status === "SUCCEEDED" && r.providerSearchId?.startsWith("stub-"))).toBe(true);
    expect(JSON.stringify(reqs.map((r) => r.params))).not.toContain("test-serp-key");
  });

  it("persists deduplicated suppliers (organic + maps merged by domain)", async () => {
    const sups = await prisma.supplier.findMany({ orderBy: { name: "asc" } });
    expect(sups.map((s) => s.name)).toEqual(["Acme Steel Works", "Beta Pipes & Fittings", "Gamma Metals"]);
    const acme = sups[0];
    expect(acme.domain).toBe("acme-steel.test");
    // the IndiaMART directory result never becomes a supplier but is still stored as search evidence
    expect(await prisma.supplier.count({ where: { domain: { contains: "indiamart" } } })).toBe(0);
    expect(await prisma.sourceDocument.count({ where: { url: { contains: "indiamart" }, supplierId: null } })).toBeGreaterThan(0);
  });

  it("keeps search + source references on the supplier (Test 1 / 2)", async () => {
    const acme = await prisma.supplier.findFirstOrThrow({ where: { name: "Acme Steel Works" } });
    const d = await getSupplierDetail(await ctx(), acme.id);
    expect(d.results.length).toBeGreaterThan(0);
    expect(d.results.some((r) => r.request.providerSearchId)).toBe(true);
    const phone = d.claims.find((c) => c.claimType === "PHONE");
    expect(phone).toBeTruthy();
    expect(phone!.evidence.length).toBeGreaterThan(0);
    for (const e of phone!.evidence) {
      expect(e.document.url).toMatch(/^https?:\/\/|manual:/);
      expect(e.document.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(e.document.retrievedAt).toBeInstanceOf(Date);
      expect(e.passage.text).toContain(e.quote.slice(0, 5));
    }
    // website pages were fetched and hashed
    const site = d.documents.filter((x) => x.sourceType === "WEBSITE_PAGE");
    expect(site.length).toBeGreaterThanOrEqual(2); // homepage + /contact
    expect(site[0].contentHash).toHaveLength(64);
  });

  it("corroborates matching contact data from website and maps", async () => {
    const acme = await prisma.supplier.findFirstOrThrow({ where: { name: "Acme Steel Works" } });
    const phone = await prisma.extractedClaim.findFirstOrThrow({ where: { supplierId: acme.id, claimType: "PHONE", normalizedValue: "+919876543210" } });
    expect(phone.status).toBe("CORROBORATED");
  });

  it("records conflicting contact details without declaring fraud (Test 3)", async () => {
    const beta = await prisma.supplier.findFirstOrThrow({ where: { name: "Beta Pipes & Fittings" } });
    const claims = await prisma.extractedClaim.findMany({ where: { supplierId: beta.id, claimType: "PHONE" } });
    expect(claims.filter((c) => c.status === "CONFLICTING")).toHaveLength(2); // official-site number vs maps number
    // a number that appears only in a (planted-looking) review is NOT trusted
    expect(claims.find((c) => c.normalizedValue === "+917000000000")?.status).toBe("INSUFFICIENT_EVIDENCE");
    const report = (await prisma.supplier.findUniqueOrThrow({ where: { id: beta.id } })).consistency as { findings: { kind: string }[]; disclaimer: string };
    expect(report.findings.some((f) => f.kind === "PHONE_CONFLICT")).toBe(true);
    const blob = JSON.stringify(report).toLowerCase();
    expect(blob).not.toMatch(/fraudulent (supplier|company|business)|is a scam|is fraud/);
    expect(report.disclaimer).toMatch(/not evidence of wrongdoing/);
  });

  it("flags prompt injection in a retrieved page, hidden element and search snippet", async () => {
    const gamma = await prisma.supplier.findFirstOrThrow({ where: { name: "Gamma Metals" } });
    const f = await prisma.securityFinding.findMany({ where: { supplierId: gamma.id }, include: { passage: true } });
    const cats = new Set(f.map((x) => x.category));
    expect(cats.has("CONTACT_SUBSTITUTION") || cats.has("EXTERNAL_COMM_REDIRECT")).toBe(true);
    expect(f.some((x) => x.passage.hidden)).toBe(true); // display:none / comment content
    const snippetFinding = await prisma.securityFinding.findFirst({ where: { document: { url: { contains: "indiamart" } } } });
    expect(snippetFinding?.category).toBe("IGNORE_PREVIOUS");
    expect(f.every((x) => x.reviewStatus === "PENDING")).toBe(true);
  });

  it("never executes scripts from supplier pages and keeps hidden text out of claims", async () => {
    const acme = await prisma.supplier.findFirstOrThrow({ where: { name: "Acme Steel Works" } });
    const docs = await prisma.sourceDocument.findMany({ where: { supplierId: acme.id, sourceType: "WEBSITE_PAGE" } });
    expect(docs.some((d) => d.text.includes("alert("))).toBe(false);
    const gamma = await prisma.supplier.findFirstOrThrow({ where: { name: "Gamma Metals" } });
    const emailClaims = await prisma.extractedClaim.findMany({ where: { supplierId: gamma.id, claimType: "EMAIL" } });
    // the attacker address appears in visible text as part of an instruction → extracted as uncorroborated/insufficient, never confirmed
    for (const c of emailClaims) expect(["UNCORROBORATED", "INSUFFICIENT_EVIDENCE", "CONFLICTING"]).toContain(c.status);
  });

  it("scores relevance against the project spec without over-claiming", async () => {
    const acme = await prisma.supplier.findFirstOrThrow({ where: { name: "Acme Steel Works" } });
    const sp = await prisma.supplierProject.findUniqueOrThrow({ where: { supplierId_projectId: { supplierId: acme.id, projectId } } });
    const rel = sp.relevance as { items: { requirement: string; status: string }[] };
    expect(rel.items.find((i) => i.requirement === "316L")?.status).toBe("MATCHED");
    expect(rel.items.find((i) => i.requirement === "ASTM A312")?.status).toBe("MATCHED");
    expect(rel.items.find((i) => i.requirement === "OD 60.3 mm")?.status).not.toBe("MATCHED");
    expect(rel.items.find((i) => i.requirement === "ISO 9001")?.status).toBe("MATCHED");
    expect(sp.distanceKm).not.toBeNull();
  });
});

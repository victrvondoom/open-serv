import type { SourcingProject } from "@/generated/prisma/client";

const COUNTRY: Record<string, { gl: string; domain: string }> = {
  india: { gl: "in", domain: "google.co.in" }, "united states": { gl: "us", domain: "google.com" }, usa: { gl: "us", domain: "google.com" }, "united kingdom": { gl: "gb", domain: "google.co.uk" },
  uk: { gl: "gb", domain: "google.co.uk" }, germany: { gl: "de", domain: "google.de" }, china: { gl: "cn", domain: "google.com.hk" }, "united arab emirates": { gl: "ae", domain: "google.ae" },
  uae: { gl: "ae", domain: "google.ae" }, singapore: { gl: "sg", domain: "google.com.sg" }, australia: { gl: "au", domain: "google.com.au" }, canada: { gl: "ca", domain: "google.ca" },
  "sri lanka": { gl: "lk", domain: "google.lk" }, bangladesh: { gl: "bd", domain: "google.com.bd" }, vietnam: { gl: "vn", domain: "google.com.vn" }, indonesia: { gl: "id", domain: "google.co.id" },
  malaysia: { gl: "my", domain: "google.com.my" }, thailand: { gl: "th", domain: "google.co.th" }, "south africa": { gl: "za", domain: "google.co.za" },
};

export function regionFor(country: string) {
  return COUNTRY[country.trim().toLowerCase()] ?? { gl: "us", domain: "google.com" };
}
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export interface PlannedQuery { engine: "GOOGLE" | "GOOGLE_MAPS"; q: string; purpose: string; params: Record<string, unknown> }

/** Queries are derived only from the project's own fields — nothing is hardcoded. */
export function generateQueries(p: Pick<SourcingProject, "productName" | "materialGrade" | "city" | "state" | "country" | "preferredSupplierType" | "requiredCertifications" | "latitude" | "longitude" | "maxRadiusKm">): PlannedQuery[] {
  const prod = clean(p.productName);
  const place = clean([p.city, p.state].filter(Boolean).join(" "));
  const loc = clean([p.city, p.state, p.country].filter(Boolean).join(", "));
  const region = regionFor(p.country);
  const type = clean(p.preferredSupplierType || "supplier");
  const g = (q: string, purpose: string): PlannedQuery => ({ engine: "GOOGLE", q: clean(q), purpose, params: { q: clean(q), location: loc, gl: region.gl, google_domain: region.domain, hl: "en", num: 10 } });
  const zoom = p.maxRadiusKm <= 5 ? 15 : p.maxRadiusKm <= 25 ? 13 : p.maxRadiusKm <= 100 ? 11 : p.maxRadiusKm <= 300 ? 9 : 8;
  const ll = p.latitude != null && p.longitude != null ? `@${p.latitude.toFixed(6)},${p.longitude.toFixed(6)},${zoom}z` : undefined;
  const m = (q: string, purpose: string): PlannedQuery => ({ engine: "GOOGLE_MAPS", q: clean(q), purpose, params: { q: clean(q), type: "search", hl: "en", ...(ll ? { ll } : {}) } });

  const out: PlannedQuery[] = [
    g(`${prod} ${type} ${place}`, "Primary supplier search"),
    g(`${prod} manufacturer ${place}`, "Manufacturer search"),
  ];
  if (p.materialGrade.trim()) out.push(g(`${prod} ${p.materialGrade} suppliers ${p.city}`, "Material-grade search"));
  if (p.requiredCertifications.length) out.push(g(`${prod} ${p.requiredCertifications[0]} certified ${p.city}`, "Certification search"));
  out.push(m(ll ? `${prod} ${type}` : `${prod} ${type} in ${place}`, "Local business listings"));
  out.push(m(ll ? `${prod} manufacturer` : `${prod} manufacturer in ${place}`, "Local manufacturer listings"));
  return out;
}

export function projectLocationQuery(p: Pick<SourcingProject, "city" | "state" | "country">): string {
  return clean([p.city, p.state, p.country].filter(Boolean).join(", "));
}

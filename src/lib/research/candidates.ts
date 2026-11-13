import { domainOf, normalizeName, tokens } from "@/lib/util";
import type { NormalizedOrganic, NormalizedPlace } from "@/lib/providers/serpapi";

/** Domains that are directories, marketplaces, social or reference sites: kept as search evidence, never turned into a supplier. */
const DIRECTORY = [
  "facebook.com", "instagram.com", "linkedin.com", "youtube.com", "twitter.com", "x.com", "wikipedia.org", "pinterest.com", "quora.com", "reddit.com", "indiamart.com", "tradeindia.com", "justdial.com",
  "alibaba.com", "made-in-china.com", "amazon.in", "amazon.com", "flipkart.com", "exportersindia.com", "sulekha.com", "yellowpages.com", "ebay.com", "glassdoor.com", "indeed.com", "naukri.com", "medium.com",
  "google.com", "maps.google.com", "bing.com", "mapquest.com", "tripadvisor.com", "yelp.com", "dnb.com", "zaubacorp.com", "mouthshut.com", "scribd.com", "slideshare.net", "udemy.com", "globalspec.com", "thomasnet.com",
  "ec21.com", "tradekey.com", "kompass.com", "europages.com", "ensun.io", "lusha.com", "zoominfo.com", "crunchbase.com", "ambitionbox.com", "99acres.com", "olx.in", "quikr.com",
];
export const isDirectoryDomain = (d: string | null) => !!d && DIRECTORY.some((x) => d === x || d.endsWith(`.${x}`));

export interface Candidate {
  name: string;
  normalizedName: string;
  website?: string;
  domain: string | null;
  place?: NormalizedPlace;
  organic: { result: NormalizedOrganic; requestId: string; searchResultId?: string }[];
  placeSources: { requestId: string; searchResultId?: string }[];
}

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  return A.size + B.size - inter ? inter / (A.size + B.size - inter) : 0;
};

/** Organic results often carry the company name before a separator: "Acme Steel Pvt Ltd - Pipes in Chennai". */
export function nameFromTitle(title: string, domain: string | null): string {
  const head = title.split(/\s[|\-–—:·]\s|\s\|\s/)[0].trim();
  const t = head.length >= 3 ? head : title;
  return t.length > 80 && domain ? domain.split(".")[0] : t;
}

export function mergeCandidates(
  places: { place: NormalizedPlace; requestId: string; searchResultId?: string }[],
  organics: { result: NormalizedOrganic; requestId: string; searchResultId?: string }[],
  excluded: string[],
): { candidates: Candidate[]; rawCount: number; directoryResults: typeof organics } {
  const exclTokens = excluded.map((e) => normalizeName(e)).filter(Boolean);
  const isExcluded = (name: string, domain: string | null) => exclTokens.some((e) => normalizeName(name).includes(e) || (domain && domain.includes(e.replace(/ /g, ""))));
  const byKey = new Map<string, Candidate>();
  const byDomain = new Map<string, Candidate>();
  let raw = 0;

  for (const { place, requestId, searchResultId } of places) {
    raw++;
    const domain = domainOf(place.website);
    if (isExcluded(place.name, domain)) continue;
    const key = place.placeId ? `place:${place.placeId}` : place.dataId ? `maps:${place.dataId}` : `name:${normalizeName(place.name)}|${normalizeName(place.address ?? "").slice(0, 20)}`;
    let c = byKey.get(key) ?? (domain && !isDirectoryDomain(domain) ? byDomain.get(domain) : undefined);
    if (!c) {
      c = { name: place.name, normalizedName: normalizeName(place.name), website: place.website, domain: domain && !isDirectoryDomain(domain) ? domain : null, place, organic: [], placeSources: [] };
      byKey.set(key, c);
    }
    c.placeSources.push({ requestId, searchResultId });
    if (!c.place) c.place = place;
    if (c.domain) byDomain.set(c.domain, c);
  }

  const directoryResults: typeof organics = [];
  for (const o of organics) {
    const { result } = o;
    const domain = result.domain;
    if (!domain || isDirectoryDomain(domain)) { directoryResults.push(o); continue; }
    raw++;
    const name = nameFromTitle(result.title, domain);
    if (isExcluded(name, domain)) continue;
    let c = byDomain.get(domain);
    if (!c) {
      // attach to a maps business without a website if names clearly match
      const nt = tokens(name);
      c = [...byKey.values()].find((x) => !x.domain && x.place && jaccard(tokens(x.name), nt) >= 0.6);
      if (c) { c.domain = domain; c.website = result.url; byDomain.set(domain, c); }
    }
    if (!c) {
      c = { name, normalizedName: normalizeName(name), website: result.url, domain, organic: [], placeSources: [] };
      byKey.set(`domain:${domain}`, c);
      byDomain.set(domain, c);
    }
    c.organic.push(o);
    if (!c.website) c.website = result.url;
  }
  return { candidates: [...byKey.values()], rawCount: raw, directoryResults };
}

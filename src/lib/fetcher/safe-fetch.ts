import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { allowPrivateFetch } from "@/lib/env";
import { sha256 } from "@/lib/util";
import { classifyBlockedIp } from "./ip";

export class FetchBlockedError extends Error {
  constructor(message: string, public reason: string) {
    super(message);
  }
}

export interface SafeFetchOptions {
  maxRedirects?: number;
  maxBytes?: number;
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  totalTimeoutMs?: number;
  allowedPorts?: number[];
  userAgent?: string;
}

export interface SafeFetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  bytes: number;
  contentHash: string;
  retrievedAt: Date;
  redirects: string[];
  truncated: boolean;
}

const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/xml", "text/xml", "application/json", "application/ld+json"];
const DEFAULTS = {
  maxRedirects: 5,
  maxBytes: 2_000_000,
  connectTimeoutMs: 8_000,
  readTimeoutMs: 10_000,
  totalTimeoutMs: 25_000,
  allowedPorts: [80, 443, 8080, 8443],
  userAgent: "PROXY-SupplierResearch/1.0 (+public-pages-only)",
};

/** Validates a URL string before any network activity. Throws FetchBlockedError. */
export function validateUrl(raw: string, opts: Pick<SafeFetchOptions, "allowedPorts"> = {}): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchBlockedError("Invalid URL", "invalid_url");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new FetchBlockedError(`Protocol ${u.protocol} is not allowed`, "protocol");
  if (u.username || u.password) throw new FetchBlockedError("URLs with embedded credentials are not allowed", "credentials");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) throw new FetchBlockedError("Missing host", "invalid_url");
  if (!allowPrivateFetch()) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal")
      throw new FetchBlockedError(`Host ${host} is not a public destination`, "private_host");
    if (net.isIP(host)) {
      const why = classifyBlockedIp(host);
      if (why) throw new FetchBlockedError(`Destination ${host} blocked: ${why}`, "private_ip");
    }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    if (!(opts.allowedPorts ?? DEFAULTS.allowedPorts).includes(port)) throw new FetchBlockedError(`Port ${port} is not allowed`, "port");
  }
  return u;
}

/**
 * DNS lookup that validates *every* resolved address and pins the connection to a validated one.
 * Because validation happens inside the socket's lookup, DNS rebinding between check and connect is impossible.
 */
function testHostMap(): Record<string, string> {
  if (!allowPrivateFetch()) return {};
  const out: Record<string, string> = {};
  for (const part of (process.env.FETCH_TEST_HOST_MAP ?? "").split(",")) { const [h, ip] = part.split("="); if (h && ip) out[h.trim().toLowerCase()] = ip.trim(); }
  return out;
}

function safeLookup(hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) {
  const mapped = testHostMap()[hostname.toLowerCase()];
  if (mapped) return options.all ? cb(null, [{ address: mapped, family: 4 }]) : cb(null, mapped, 4);
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, "", 0);
    const list = (addrs as dns.LookupAddress[]) ?? [];
    if (!allowPrivateFetch()) {
      for (const a of list) {
        const why = classifyBlockedIp(a.address);
        if (why) {
          const e = new FetchBlockedError(`Destination ${hostname} resolves to ${a.address}: ${why}`, "private_ip") as unknown as NodeJS.ErrnoException;
          e.code = "EBLOCKED";
          return cb(e, "", 0);
        }
      }
    }
    if (!list.length) return cb(Object.assign(new Error("No addresses"), { code: "ENOTFOUND" }) as NodeJS.ErrnoException, "", 0);
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function requestOnce(u: URL, o: Required<SafeFetchOptions>, deadline: number): Promise<{ res: http.IncomingMessage; req: http.ClientRequest }> {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      u,
      {
        method: "GET",
        lookup: safeLookup as never,
        headers: { "user-agent": o.userAgent, accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1", "accept-encoding": "gzip, deflate, br", "accept-language": "en" },
        agent: false,
      },
      (res) => resolve({ res, req }),
    );
    const connectTimer = setTimeout(() => req.destroy(new Error("Connection timeout")), o.connectTimeoutMs);
    req.on("socket", (s) => {
      const clear = () => clearTimeout(connectTimer);
      if (s.connecting) s.once(u.protocol === "https:" ? "secureConnect" : "connect", clear);
      else clear();
    });
    const totalTimer = setTimeout(() => req.destroy(new Error("Total timeout exceeded")), Math.max(1, deadline - Date.now()));
    req.on("close", () => {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    });
    req.on("error", (e) => {
      clearTimeout(connectTimer);
      reject(e);
    });
    req.end();
  });
}

async function readBody(res: http.IncomingMessage, o: Required<SafeFetchOptions>): Promise<{ buf: Buffer; truncated: boolean }> {
  const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
  let stream: NodeJS.ReadableStream = res;
  if (enc === "gzip" || enc === "x-gzip") stream = res.pipe(zlib.createGunzip());
  else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
  else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
  else if (enc && enc !== "identity") throw new FetchBlockedError(`Unsupported content-encoding ${enc}`, "encoding");
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let truncated = false;
    let idle = setTimeout(() => done(new Error("Read timeout")), o.readTimeoutMs);
    const done = (err?: Error) => {
      clearTimeout(idle);
      if (err) {
        res.destroy();
        return reject(err);
      }
      resolve({ buf: Buffer.concat(chunks), truncated });
    };
    stream.on("data", (c: Buffer) => {
      clearTimeout(idle);
      idle = setTimeout(() => done(new Error("Read timeout")), o.readTimeoutMs);
      total += c.length;
      if (total > o.maxBytes) {
        chunks.push(c.subarray(0, c.length - (total - o.maxBytes)));
        truncated = true;
        res.destroy();
        return done();
      }
      chunks.push(c);
    });
    stream.on("end", () => done());
    stream.on("error", (e) => done(e));
    res.on("error", (e) => done(e));
  });
}

/**
 * The ONLY sanctioned way to retrieve a third-party URL. Callers must never fetch URLs directly.
 * - http/https only, public destinations only (DNS validated at connect time, revalidated on each redirect)
 * - bounded redirects, size, time; only text-like content types; never executes anything it retrieves.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const o = { ...DEFAULTS, ...options } as Required<SafeFetchOptions>;
  const deadline = Date.now() + o.totalTimeoutMs;
  const redirects: string[] = [];
  let current = validateUrl(rawUrl, o);

  for (let hop = 0; hop <= o.maxRedirects; hop++) {
    let res: http.IncomingMessage;
    try {
      ({ res } = await requestOnce(current, o, deadline));
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "EBLOCKED" || e instanceof FetchBlockedError) throw e instanceof FetchBlockedError ? e : new FetchBlockedError(err.message, "private_ip");
      throw e;
    }
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hop === o.maxRedirects) throw new FetchBlockedError(`Too many redirects (>${o.maxRedirects})`, "redirects");
      const next = new URL(res.headers.location, current);
      redirects.push(next.toString());
      current = validateUrl(next.toString(), o); // revalidate after redirect
      continue;
    }
    const contentType = String(res.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (status >= 200 && status < 300 && !ALLOWED_TYPES.includes(contentType) && contentType !== "") {
      res.resume();
      throw new FetchBlockedError(`Unsupported content type "${contentType}"`, "content_type");
    }
    const declared = Number(res.headers["content-length"] ?? 0);
    if (declared > o.maxBytes * 4 && !res.headers["content-encoding"]) {
      res.resume();
      throw new FetchBlockedError(`Response too large (${declared} bytes)`, "too_large");
    }
    const { buf, truncated } = await readBody(res, o);
    const body = buf.toString("utf8");
    return {
      url: rawUrl,
      finalUrl: current.toString(),
      status,
      contentType: contentType || "text/plain",
      body,
      bytes: buf.length,
      contentHash: sha256(buf),
      retrievedAt: new Date(),
      redirects,
      truncated,
    };
  }
  throw new FetchBlockedError("Too many redirects", "redirects");
}

import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/errors";
import { getContext, type Ctx } from "@/lib/context";

type RouteCtx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx, params: Record<string, string>) => Promise<Response | unknown>;

export const json = (data: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

export function errorResponse(e: unknown): Response {
  if (e instanceof ApiError) return json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, e.status, e.status === 429 ? { "retry-after": String((e.details as { retryAfter?: number })?.retryAfter ?? 30) } : undefined);
  if (e instanceof ZodError) return json({ error: { code: "validation_error", message: "Request validation failed", details: e.flatten() } }, 400);
  const id = randomUUID().slice(0, 8);
  console.error(`[api error ${id}]`, e); // stack stays in the server log, never in the response
  return json({ error: { code: "internal_error", message: `Something went wrong. Reference: ${id}`, details: null } }, 500);
}

/** Wraps a route handler: workspace context, uniform JSON errors, no stack traces leaked. */
export function handle(fn: Handler) {
  return async (req: Request, rc: RouteCtx): Promise<Response> => {
    try {
      const ctx = await getContext(req);
      const out = await fn(req, ctx, rc?.params ? await rc.params : {});
      return out instanceof Response ? out : json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const t = await req.text();
    return (t ? JSON.parse(t) : {}) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
}

export const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams.entries());

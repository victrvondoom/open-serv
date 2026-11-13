"use client";

export class ApiClientError extends Error {
  constructor(message: string, public code: string, public status: number, public details?: unknown) {
    super(message);
  }
}

/** Typed fetch wrapper that surfaces the server's structured error. */
export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(url, { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers: opts.body !== undefined ? { "content-type": "application/json" } : undefined, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    throw new ApiClientError(e?.message ?? `Request failed (${res.status})`, e?.code ?? "error", res.status, e?.details);
  }
  return data as T;
}

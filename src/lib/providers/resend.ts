import { env, isConfigured } from "@/lib/env";
import { notConfigured } from "@/lib/errors";
import { errMessage } from "@/lib/util";

export interface ResendResult { ok: boolean; status: number; id?: string; body: unknown; error?: string }

export async function resendSend(msg: { to: string; subject: string; text: string; replyTo?: string; idempotencyKey?: string }): Promise<ResendResult> {
  if (!isConfigured.resend()) throw notConfigured("Resend", "Set RESEND_API_KEY and RESEND_FROM_EMAIL (a sender verified in Resend).");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${env().RESEND_BASE_URL}/emails`, {
      method: "POST",
      signal: ctl.signal,
      headers: {
        authorization: `Bearer ${env().RESEND_API_KEY}`,
        "content-type": "application/json",
        ...(msg.idempotencyKey ? { "Idempotency-Key": msg.idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: env().RESEND_FROM_EMAIL, to: [msg.to], subject: msg.subject, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (res.ok && body.id) return { ok: true, status: res.status, id: body.id, body };
    return { ok: false, status: res.status, body, error: body.message ?? `Resend returned HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, body: {}, error: `Resend request failed: ${errMessage(e)}` };
  } finally {
    clearTimeout(t);
  }
}

/** Authenticated, side-effect-free check: lists domains (needs a full-access or domain-read key). */
export async function checkResend(): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured.resend()) return { ok: false, message: !env().RESEND_API_KEY ? "RESEND_API_KEY is not set." : "RESEND_FROM_EMAIL is not set." };
  try {
    const res = await fetch(`${env().RESEND_BASE_URL}/domains`, { headers: { authorization: `Bearer ${env().RESEND_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) return { ok: true, message: "API key accepted by Resend" };
    // Sending-only keys are restricted from /domains; that is an authenticated response, not a bad key.
    if (res.status === 401 || res.status === 403) {
      const b = (await res.json().catch(() => ({}))) as { name?: string; message?: string };
      if (b.name === "restricted_api_key") return { ok: true, message: "API key accepted (sending-only restricted key)" };
      return { ok: false, message: `Resend rejected the API key: ${b.message ?? res.status}` };
    }
    return { ok: false, message: `Resend returned HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: `Could not reach Resend: ${errMessage(e)}` };
  }
}

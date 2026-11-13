import OpenAI from "openai";
import { z } from "zod";
import { env, isConfigured } from "@/lib/env";
import { notConfigured } from "@/lib/errors";
import { errMessage } from "@/lib/util";

let client: OpenAI | undefined;
let clientKey = "";

export function openai(): OpenAI {
  if (!isConfigured.openai()) throw notConfigured("OpenAI", "Set OPENAI_API_KEY and OPENAI_MODEL (see .env.example).");
  const key = `${env().OPENAI_API_KEY}|${env().OPENAI_BASE_URL}`;
  if (!client || clientKey !== key) {
    client = new OpenAI({ apiKey: env().OPENAI_API_KEY, baseURL: env().OPENAI_BASE_URL, timeout: 60_000, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

export interface LlmUsage { inputTokens: number; outputTokens: number }

/** Structured-output call. The response is validated with Zod; an invalid response is an error, never a guess. */
export async function llmJson<T>(opts: {
  system: string; user: string; schemaName: string; jsonSchema: Record<string, unknown>; zod: z.ZodType<T>; temperature?: number;
}): Promise<{ data: T; usage: LlmUsage; model: string }> {
  const model = env().OPENAI_MODEL!;
  const res = await openai().chat.completions.create({
    model,
    messages: [{ role: "system", content: opts.system }, { role: "user", content: opts.user }],
    response_format: { type: "json_schema", json_schema: { name: opts.schemaName, strict: true, schema: opts.jsonSchema } },
    ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
  });
  const content = res.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("OpenAI returned non-JSON content"); }
  const data = opts.zod.parse(parsed);
  return { data, usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 }, model: res.model ?? model };
}

export async function checkOpenAI(): Promise<{ ok: boolean; message: string }> {
  if (!isConfigured.openai()) return { ok: false, message: !env().OPENAI_API_KEY ? "OPENAI_API_KEY is not set." : "OPENAI_MODEL is not set." };
  try {
    const m = await openai().models.retrieve(env().OPENAI_MODEL!);
    return { ok: true, message: `Authenticated; model ${m.id} available` };
  } catch (e) {
    return { ok: false, message: `OpenAI check failed: ${errMessage(e).slice(0, 200)}` };
  }
}

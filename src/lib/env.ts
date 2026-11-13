import { z } from "zod";

const optional = z.string().trim().optional().transform((v) => (v ? v : undefined));

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SERPAPI_API_KEY: optional,
  SERPAPI_BASE_URL: z.string().url().default("https://serpapi.com"),
  SERPAPI_CACHE_TTL_HOURS: z.coerce.number().min(0).default(24),
  SERPAPI_REQUESTS_PER_MINUTE: z.coerce.number().min(1).default(60),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: optional,
  OPENAI_BASE_URL: optional,
  OPENAI_INPUT_PRICE_PER_MTOK: z.coerce.number().optional(),
  OPENAI_OUTPUT_PRICE_PER_MTOK: z.coerce.number().optional(),
  SERPAPI_PRICE_PER_SEARCH: z.coerce.number().optional(),
  RESEND_API_KEY: optional,
  RESEND_FROM_EMAIL: optional,
  RESEND_BASE_URL: z.string().url().default("https://api.resend.com"),
  RESEARCH_MAX_SUPPLIERS: z.coerce.number().int().min(1).max(100).default(25),
  FETCH_ALLOW_PRIVATE_FOR_TESTS: optional,
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;
let cached: Env | undefined;

/** Server-side validated configuration. Never import from client components. */
export function env(): Env {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${msg}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache() {
  cached = undefined;
}

export const isConfigured = {
  serpapi: () => !!env().SERPAPI_API_KEY,
  openai: () => !!env().OPENAI_API_KEY && !!env().OPENAI_MODEL,
  resend: () => !!env().RESEND_API_KEY && !!env().RESEND_FROM_EMAIL,
};

/** Private-destination fetching is only ever allowed outside production, and only when explicitly opted in. */
export function allowPrivateFetch(): boolean {
  return env().NODE_ENV !== "production" && env().FETCH_ALLOW_PRIVATE_FOR_TESTS === "1";
}

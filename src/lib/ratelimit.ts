import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";

/**
 * PostgreSQL-backed fixed-window rate limiter (survives restarts, shared by all processes).
 * Throws 429 when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowSec * 1000)) * windowSec * 1000);
  const row = await prisma.rateLimitBucket.upsert({
    where: { key_windowStart: { key, windowStart } },
    update: { count: { increment: 1 } },
    create: { key, windowStart, count: 1 },
  });
  if (row.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + windowSec * 1000 - now) / 1000));
    throw new ApiError(429, "rate_limited", `Rate limit exceeded for ${key.split(":")[0]}. Retry in ${retryAfter}s.`, { retryAfter });
  }
  // opportunistic cleanup of old buckets
  if (Math.random() < 0.02) {
    await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(now - 3600_000) } } }).catch(() => undefined);
  }
}

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const g = globalThis as unknown as { __prisma?: PrismaClient };

function create(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 10 }) });
}

export const prisma: PrismaClient = g.__prisma ?? (g.__prisma = create());
export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

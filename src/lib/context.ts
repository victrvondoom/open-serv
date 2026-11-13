import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

export interface Ctx {
  workspaceId: string;
  userId: string;
  userEmail: string;
  mode: "local" | "session";
}

const LOCAL_EMAIL = "local@proxy.dev";
const LOCAL_SLUG = "local";
let localCache: Ctx | undefined;

/**
 * Local development authentication: a single owner user and workspace, created on first use.
 * Every query in the application is scoped by ctx.workspaceId, so adding real authentication
 * only requires replacing this function (see docs/ARCHITECTURE.md → Authentication).
 */
export async function getLocalContext(): Promise<Ctx> {
  if (localCache) {
    const ok = await prisma.workspace.findUnique({ where: { id: localCache.workspaceId }, select: { id: true } });
    if (ok) return localCache;
    localCache = undefined;
  }
  const ctx = await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({ where: { email: LOCAL_EMAIL }, update: {}, create: { email: LOCAL_EMAIL, name: "Local Operator" } });
    const ws = await tx.workspace.upsert({ where: { slug: LOCAL_SLUG }, update: {}, create: { slug: LOCAL_SLUG, name: "Local Workspace" } });
    await tx.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId: ws.id, userId: user.id } },
      update: {},
      create: { workspaceId: ws.id, userId: user.id, role: "OWNER" },
    });
    return { workspaceId: ws.id, userId: user.id, userEmail: user.email, mode: "local" as const };
  });
  localCache = ctx;
  return ctx;
}

/** Signed session token (HMAC-SHA256 over `userId.workspaceId`). Used by API clients / future login flow. */
export function signSession(userId: string, workspaceId: string): string {
  const body = `${userId}.${workspaceId}`;
  const sig = createHmac("sha256", env().AUTH_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export async function verifySession(token: string): Promise<Ctx | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, workspaceId, sig] = parts;
  const expect = createHmac("sha256", env().AUTH_SECRET).update(`${userId}.${workspaceId}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { user: true },
  });
  if (!m) return null;
  return { workspaceId, userId, userEmail: m.user.email, mode: "session" };
}

/** Resolve the caller. A valid bearer session token selects its workspace; otherwise local mode. */
export async function getContext(req?: Request): Promise<Ctx> {
  const auth = req?.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const ctx = await verifySession(auth.slice(7));
    if (ctx) return ctx;
  }
  return getLocalContext();
}

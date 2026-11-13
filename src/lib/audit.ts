import { prisma, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/context";
import type { ActorType } from "@/generated/prisma/client";

type Db = Pick<typeof prisma, "auditEvent">;

export async function audit(
  ctx: Pick<Ctx, "workspaceId"> & { userId?: string },
  action: string,
  entityType: string,
  entityId: string | null | undefined,
  metadata: Record<string, unknown> = {},
  opts: { actorType?: ActorType; actorId?: string; tx?: Tx } = {},
) {
  const db: Db = opts.tx ?? prisma;
  await db.auditEvent.create({
    data: {
      workspaceId: ctx.workspaceId,
      actorType: opts.actorType ?? "USER",
      actorId: opts.actorId ?? ctx.userId ?? "system",
      action,
      entityType,
      entityId: entityId ?? null,
      metadata: metadata as object,
    },
  });
}

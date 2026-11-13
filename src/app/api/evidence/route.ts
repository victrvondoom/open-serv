import { handle, query } from "@/lib/api/route";
import { listConflicts, searchEvidence } from "@/lib/evidence/service";
export const GET = handle(async (req, ctx) => { const q = query(req); if (q.view === "conflicts") return { groups: await listConflicts(ctx, { supplierId: q.supplierId, projectId: q.projectId }) }; return searchEvidence(ctx, q); });

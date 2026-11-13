import { handle, query } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { exportDataset } from "@/lib/benchmarks/service";
export const GET = handle(async (req, ctx) => { const q = query(req); if (!q.suiteId) throw badRequest("suiteId is required"); const fmt = q.format === "jsonl" ? "jsonl" : "json"; const text = await exportDataset(ctx, q.suiteId, fmt); return new Response(text, { headers: { "content-type": fmt === "jsonl" ? "application/x-ndjson" : "application/json", "content-disposition": `attachment; filename="benchmark-dataset.${fmt}"` } }); });

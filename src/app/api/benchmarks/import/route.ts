import { body, handle, json } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { importDataset } from "@/lib/benchmarks/service";
export const POST = handle(async (req, ctx) => { const b = await body<{ content?: string; suiteName?: string }>(req); if (!b.content) throw badRequest("content is required"); return json(await importDataset(ctx, b.content, b.suiteName ?? "Imported scenarios"), 201); });

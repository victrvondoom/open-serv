import { handle, query } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { getComparison, previewComparison, toCsv, toPdf, weightsOf } from "@/lib/compare/service";

export const GET = handle(async (req, ctx, p) => {
  const fmt = query(req).format ?? "csv";
  const c = await getComparison(ctx, p.id);
  const w = weightsOf(c);
  const live = await previewComparison(ctx, { supplierIds: c.supplierIds, projectId: c.projectId, weights: w });
  const safe = c.name.replace(/[^a-z0-9]+/gi, "_");
  if (fmt === "csv") return new Response(toCsv(live.ranked, w), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${safe}.csv"` } });
  if (fmt === "pdf") { const buf = await toPdf(c.name, c.project?.name ?? null, live.ranked, w); return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${safe}.pdf"` } }); }
  throw badRequest("format must be csv or pdf");
});

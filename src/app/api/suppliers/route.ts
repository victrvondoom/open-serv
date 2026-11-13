import { body, handle, json, query } from "@/lib/api/route";
import { createManualSupplier, listSuppliers, supplierFilters } from "@/lib/suppliers";

export const GET = handle(async (req, ctx) => listSuppliers(ctx, supplierFilters.parse(query(req))));
export const POST = handle(async (req, ctx) => { const b = await body<Record<string, unknown>>(req); return json(await createManualSupplier(ctx, b, typeof b.projectId === "string" ? b.projectId : undefined), 201); });

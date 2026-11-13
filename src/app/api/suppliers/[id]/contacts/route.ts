import { z } from "zod";
import { body, handle, json } from "@/lib/api/route";
import { badRequest } from "@/lib/errors";
import { addManualContact } from "@/lib/suppliers";

const z1 = z.object({ type: z.enum(["PHONE", "EMAIL", "ADDRESS"]), value: z.string().min(3).max(300), note: z.string().max(500).optional() });
export const POST = handle(async (req, ctx, p) => { const b = z1.safeParse(await body(req)); if (!b.success) throw badRequest("Invalid contact", b.error.flatten()); return json(await addManualContact(ctx, p.id, b.data.type, b.data.value, b.data.note), 201); });

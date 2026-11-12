import { z } from "zod";
import { getDb } from "@/lib/db";
import { REMEDIES, SEVERITIES } from "@/lib/db/schema";
import { recallExposure } from "@/lib/recalls/exposure";

// Read-only: the analytics agent's "what if we recalled this?" tool. Writes nothing.
const Body = z.object({
  skus: z.array(z.string().min(1)).min(1).max(50),
  soldFrom: z.string().date().optional(),
  soldTo: z.string().date().optional(),
  severity: z.enum(SEVERITIES).optional(),
  remedies: z.array(z.enum(REMEDIES)).optional(),
  replacementStock: z.number().int().min(0).nullable().optional(),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const b = parsed.data;
  return Response.json(
    recallExposure(getDb(), {
      ...b,
      soldFrom: b.soldFrom ? new Date(`${b.soldFrom}T00:00:00Z`) : null,
      soldTo: b.soldTo ? new Date(`${b.soldTo}T23:59:59Z`) : null,
    }),
  );
}

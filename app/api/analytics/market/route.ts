import { eq } from "drizzle-orm";
import { z } from "zod";
import { marketCheck } from "@/lib/channel3";
import { getDb, t } from "@/lib/db";

// The analytics agent's market_check tool: Channel3 retailer data for one catalog SKU.
export async function POST(request: Request) {
  const parsed = z.object({ sku: z.string().min(1) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "sku is required" }, { status: 400 });
  const product = getDb().select().from(t.products).where(eq(t.products.sku, parsed.data.sku)).get();
  if (!product) return Response.json({ error: `No product with SKU ${parsed.data.sku}` }, { status: 404 });
  const r = await marketCheck(product);
  if (!r.enabled) return Response.json({ error: "Channel3 is not configured (CHANNEL3_API_KEY)." }, { status: 503 });
  const brief = (ls: typeof r.onSale) => ls.map((l) => ({ title: l.title, brand: l.brand, retailers: l.retailers.slice(0, 3) }));
  return Response.json({ sku: product.sku, product: product.name, stillOnSale: brief(r.onSale), safeAlternatives: brief(r.alternatives), alternativesFrom: r.alternativesVia, error: r.error });
}

import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import { recentRecalls, type Notice } from "@/lib/cpsc";
import { matchNotice, type CatalogItem, type Match } from "./matcher";
import { skuSalesSummary } from "./queries";

export type WatchHit = { notice: Notice; matches: (Match & { units: number; buyers: number })[] };

// Recent government recalls that match products this seller has actually sold,
// minus the ones already turned into a recall here.
export async function recallWatch(db: DB, catalog: CatalogItem[], days = 90): Promise<{ hits: WatchHit[]; scanned: number; error?: string }> {
  let notices: Notice[];
  try {
    notices = await recentRecalls(days);
  } catch (err) {
    return { hits: [], scanned: 0, error: err instanceof Error ? err.message : String(err) };
  }
  const sold = new Map(skuSalesSummary(db).map((s) => [s.sku, s]));
  const used = new Set(db.select({ url: t.recalls.sourceUrl }).from(t.recalls).where(eq(t.recalls.status, "active")).all().map((r) => r.url));

  const hits: WatchHit[] = [];
  for (const notice of notices) {
    if (used.has(notice.url)) continue;
    const matches = matchNotice(notice, catalog)
      .filter((m) => sold.has(m.sku))
      .map((m) => ({ ...m, units: sold.get(m.sku)!.units, buyers: sold.get(m.sku)!.buyers }));
    if (matches.length) hits.push({ notice, matches });
  }
  return { hits, scanned: notices.length };
}

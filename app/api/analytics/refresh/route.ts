import { eq } from "drizzle-orm";
import { getDb, t } from "@/lib/db";
import { syncRecall } from "@/lib/recalls/sync";

// Re-reads PayPal for every refund and payout still in flight, across active recalls.
export async function POST() {
  const db = getDb();
  const recalls = db.select({ id: t.recalls.id }).from(t.recalls).where(eq(t.recalls.status, "active")).all();
  let checked = 0, changed = 0;
  const errors: string[] = [];
  for (const { id } of recalls) {
    const r = await syncRecall(db, id);
    checked += r.checked;
    changed += r.changed;
    errors.push(...r.errors);
  }
  return Response.json({ recalls: recalls.length, checked, changed, errors: errors.slice(0, 10) });
}

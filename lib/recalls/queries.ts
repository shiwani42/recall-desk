import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";

export function recallSummaries(db: DB) {
  return db
    .select({
      recall: t.recalls,
      skus: sql<string>`(select group_concat(sku, ', ') from ${t.recallSkus} where ${t.recallSkus.recallId} = ${t.recalls.id})`,
      cases: sql<number>`count(${t.recallCases.id})`,
      units: sql<number>`coalesce(sum(${t.recallCases.quantity}), 0)`,
      notified: sql<number>`sum(case when ${t.recallCases.status} != 'identified' then 1 else 0 end)`,
      resolved: sql<number>`sum(case when ${t.recallCases.status} = 'resolved' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${t.recallCases.status} = 'failed' then 1 else 0 end)`,
      processing: sql<number>`sum(case when ${t.recallCases.status} = 'processing' then 1 else 0 end)`,
      shipping: sql<number>`sum(case when ${t.recallCases.status} = 'remedy_selected' then 1 else 0 end)`,
      waiting: sql<number>`sum(case when ${t.recallCases.status} = 'notified' then 1 else 0 end)`,
      identified: sql<number>`sum(case when ${t.recallCases.status} = 'identified' then 1 else 0 end)`,
    })
    .from(t.recalls)
    .leftJoin(t.recallCases, eq(t.recallCases.recallId, t.recalls.id))
    .groupBy(t.recalls.id)
    .orderBy(desc(t.recalls.createdAt))
    .all();
}

export function recallDetail(db: DB, id: string) {
  const recall = db.select().from(t.recalls).where(eq(t.recalls.id, id)).get();
  if (!recall) return null;
  const skus = db.select({ sku: t.recallSkus.sku }).from(t.recallSkus).where(eq(t.recallSkus.recallId, id)).all().map((r) => r.sku);
  const cases = db
    .select({ c: t.recallCases, sale: t.sales, item: t.saleItems })
    .from(t.recallCases)
    .innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId))
    .innerJoin(t.saleItems, eq(t.saleItems.id, t.recallCases.saleItemId))
    .where(eq(t.recallCases.recallId, id))
    .orderBy(t.sales.capturedAt)
    .all();
  return { recall, skus, cases };
}

export function caseByToken(db: DB, token: string) {
  return (
    db
      .select({ c: t.recallCases, sale: t.sales, item: t.saleItems, recall: t.recalls })
      .from(t.recallCases)
      .innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId))
      .innerJoin(t.saleItems, eq(t.saleItems.id, t.recallCases.saleItemId))
      .innerJoin(t.recalls, eq(t.recalls.id, t.recallCases.recallId))
      .where(eq(t.recallCases.buyerToken, token))
      .get() ?? null
  );
}

export function skuSalesSummary(db: DB) {
  return db
    .select({
      sku: t.saleItems.sku,
      name: sql<string>`max(${t.saleItems.name})`,
      units: sql<number>`sum(${t.saleItems.quantity})`,
      buyers: sql<number>`count(distinct ${t.sales.id})`,
      firstSold: sql<number>`min(${t.sales.capturedAt})`,
      lastSold: sql<number>`max(${t.sales.capturedAt})`,
    })
    .from(t.saleItems)
    .innerJoin(t.sales, eq(t.sales.id, t.saleItems.saleId))
    .groupBy(t.saleItems.sku)
    .orderBy(t.saleItems.sku)
    .all();
}

export function ledgerTotals(db: DB) {
  return db
    .select({
      sales: sql<number>`count(distinct ${t.sales.id})`,
      units: sql<number>`coalesce(sum(${t.saleItems.quantity}), 0)`,
      skus: sql<number>`count(distinct ${t.saleItems.sku})`,
    })
    .from(t.sales)
    .leftJoin(t.saleItems, eq(t.saleItems.saleId, t.sales.id))
    .get()!;
}

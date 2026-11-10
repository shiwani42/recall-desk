import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { Remedy, Severity } from "@/lib/db/schema";
import { recommendRemedy } from "./remedy";

export type NewRecall = {
  title: string;
  hazard: string;
  severity: Severity;
  instructions?: string;
  skus: string[];
  remedies: Remedy[];
  replacementStock?: number | null;
  soldFrom?: Date | null;
  soldTo?: Date | null;
  sourceUrl?: string | null;
};

const newRecallId = () => `RC-${randomBytes(3).toString("hex").toUpperCase()}`;
const newToken = () => randomBytes(18).toString("base64url");

export function logEvent(db: DB, caseId: number, type: string, detail = "") {
  db.insert(t.caseEvents).values({ caseId, type, detail }).run();
}

export function createRecall(db: DB, input: NewRecall, now = new Date()) {
  const id = newRecallId();
  db.transaction((tx) => {
    tx.insert(t.recalls)
      .values({
        id,
        title: input.title,
        hazard: input.hazard,
        severity: input.severity,
        instructions: input.instructions ?? "",
        remedies: input.remedies,
        replacementStock: input.replacementStock ?? null,
        soldFrom: input.soldFrom ?? null,
        soldTo: input.soldTo ?? null,
        sourceUrl: input.sourceUrl ?? null,
      })
      .run();
    tx.insert(t.recallSkus).values([...new Set(input.skus)].map((sku) => ({ recallId: id, sku }))).run();
  });
  const match = matchRecall(db, id, now);
  return { id, ...match };
}

// Find every sold unit affected by a recall and open a case for it.
// Safe to re-run: when new sales are imported, only the new ones get cases.
export function matchRecall(db: DB, recallId: string, now = new Date()) {
  const recall = db.select().from(t.recalls).where(eq(t.recalls.id, recallId)).get();
  if (!recall) throw new Error(`Recall ${recallId} not found`);
  const skus = db.select({ sku: t.recallSkus.sku }).from(t.recallSkus).where(eq(t.recallSkus.recallId, recallId)).all().map((r) => r.sku);
  if (skus.length === 0) return { newCases: 0, totalCases: 0 };

  const affected = db
    .select({ item: t.saleItems, sale: t.sales })
    .from(t.saleItems)
    .innerJoin(t.sales, eq(t.sales.id, t.saleItems.saleId))
    .where(
      and(
        inArray(t.saleItems.sku, skus),
        recall.soldFrom ? gte(t.sales.capturedAt, recall.soldFrom) : undefined,
        recall.soldTo ? lte(t.sales.capturedAt, recall.soldTo) : undefined,
      ),
    )
    .orderBy(asc(t.sales.capturedAt))
    .all();

  // Replacement units already promised by existing cases.
  const promised = db
    .select({ units: sql<number>`coalesce(sum(${t.recallCases.quantity}), 0)` })
    .from(t.recallCases)
    .where(and(eq(t.recallCases.recallId, recallId), sql`coalesce(${t.recallCases.chosenRemedy}, ${t.recallCases.recommendedRemedy}) = 'replace'`))
    .get()!.units;
  let stockLeft = recall.replacementStock === null ? null : recall.replacementStock - promised;

  let newCases = 0;
  db.transaction((tx) => {
    for (const { item, sale } of affected) {
      const rec = recommendRemedy({
        severity: recall.severity,
        allowed: recall.remedies,
        unitPriceCents: item.unitPriceCents,
        quantity: item.quantity,
        replacementStockLeft: stockLeft,
        capturedAt: sale.capturedAt,
        hasCapture: Boolean(sale.captureId),
        now,
      });
      const inserted = tx
        .insert(t.recallCases)
        .values({
          recallId,
          saleId: sale.id,
          saleItemId: item.id,
          sku: item.sku,
          quantity: item.quantity,
          refundAmountCents: item.unitPriceCents * item.quantity,
          recommendedRemedy: rec.remedy,
          refundRail: rec.refundRail,
          recommendationReason: rec.reason,
          buyerToken: newToken(),
        })
        .onConflictDoNothing()
        .returning({ id: t.recallCases.id })
        .all();
      if (inserted.length) {
        newCases++;
        if (rec.remedy === "replace" && stockLeft !== null) stockLeft -= item.quantity;
        tx.insert(t.caseEvents)
          .values({ caseId: inserted[0].id, type: "identified", detail: `${item.quantity}× ${item.sku} → recommend ${rec.remedy}` })
          .run();
      }
    }
  });

  const totalCases = db
    .select({ n: sql<number>`count(*)` })
    .from(t.recallCases)
    .where(eq(t.recallCases.recallId, recallId))
    .get()!.n;
  return { newCases, totalCases };
}

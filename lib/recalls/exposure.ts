// "What if we recalled this?": the exposure of a hypothetical recall, with the same matching window,
// remedy rules and refund-rail logic a real recall uses, but nothing is written. Used by the
// analytics agent's recall_exposure tool.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { Remedy, Severity } from "@/lib/db/schema";
import { recommendRemedy } from "./remedy";

export type ExposureInput = {
  skus: string[];
  soldFrom?: Date | null;
  soldTo?: Date | null;
  severity?: Severity;
  remedies?: Remedy[];
  replacementStock?: number | null;
};

const dollars = (c: number) => Math.round(c) / 100;

export function recallExposure(db: DB, input: ExposureInput, now = new Date()) {
  const remedies = input.remedies?.length ? input.remedies : (["refund"] as Remedy[]);
  const rows = db
    .select({ item: t.saleItems, sale: t.sales })
    .from(t.saleItems)
    .innerJoin(t.sales, eq(t.sales.id, t.saleItems.saleId))
    .where(
      and(
        inArray(t.saleItems.sku, input.skus),
        input.soldFrom ? gte(t.sales.capturedAt, input.soldFrom) : undefined,
        input.soldTo ? lte(t.sales.capturedAt, input.soldTo) : undefined,
      ),
    )
    .all();

  let stockLeft = input.replacementStock ?? null;
  const byRemedy: Record<string, { lines: number; dollars: number }> = {};
  const byRail: Record<string, { lines: number; dollars: number }> = {};
  const byState: Record<string, number> = {};
  const buyers = new Set<string>();
  let units = 0;
  let exposureCents = 0;

  for (const { item, sale } of rows.sort((a, b) => a.sale.capturedAt.getTime() - b.sale.capturedAt.getTime())) {
    const cents = item.unitPriceCents * item.quantity;
    const rec = recommendRemedy({
      severity: input.severity ?? "high",
      allowed: remedies,
      unitPriceCents: item.unitPriceCents,
      quantity: item.quantity,
      replacementStockLeft: stockLeft,
      capturedAt: sale.capturedAt,
      hasCapture: Boolean(sale.captureId),
      now,
    });
    if (rec.remedy === "replace" && stockLeft !== null) stockLeft -= item.quantity;
    const rail = rec.remedy === "refund" ? (rec.refundRail === "paypal_refund" ? "PayPal refund" : "PayPal payout") : "No money moves";
    (byRemedy[rec.remedy] ??= { lines: 0, dollars: 0 }).lines++;
    byRemedy[rec.remedy].dollars += dollars(cents);
    (byRail[rail] ??= { lines: 0, dollars: 0 }).lines++;
    byRail[rail].dollars += dollars(cents);
    const state = sale.shipAddress?.state ?? "unknown";
    byState[state] = (byState[state] ?? 0) + item.quantity;
    buyers.add(sale.buyerEmail ?? sale.id);
    units += item.quantity;
    exposureCents += cents;
  }

  const round = <T extends Record<string, { lines: number; dollars: number }>>(o: T) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { lines: v.lines, dollars: Math.round(v.dollars * 100) / 100 }]));

  return {
    skus: input.skus,
    window: { from: input.soldFrom?.toISOString().slice(0, 10) ?? null, to: input.soldTo?.toISOString().slice(0, 10) ?? null },
    affectedLines: rows.length,
    buyers: buyers.size,
    units,
    exposure: dollars(exposureCents),
    cashOut: Math.round(((byRail["PayPal refund"]?.dollars ?? 0) + (byRail["PayPal payout"]?.dollars ?? 0)) * 100) / 100,
    byRemedy: round(byRemedy),
    byMoneyRail: round(byRail),
    topStates: Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([state, u]) => ({ state, units: u })),
    replacementStockLeft: stockLeft,
  };
}

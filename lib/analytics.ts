// Flat, plain-object tables for the AG Studio analytics page. Studio joins them itself through the
// relationships declared in components/analytics/data.ts, so each table stays one row per record.
// Money is in dollars here (Studio formats it), not cents.

import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { CaseStatus } from "@/lib/db/schema";

const REFUND_WINDOW_DAYS = 180;
const DAY = 864e5;

export const STATUS_LABEL: Record<CaseStatus, string> = {
  resolved: "Resolved",
  processing: "Money in flight",
  remedy_selected: "Awaiting shipment",
  notified: "Notified, no reply yet",
  identified: "Not yet notified",
  failed: "Failed",
};

// Done → in progress → pending → failed, the same order as the status bar.
export const STATUS_ORDER = Object.keys(STATUS_LABEL) as CaseStatus[];

const RAIL_LABEL = { paypal_refund: "PayPal refund", payout: "PayPal payout", none: "No money moves" } as const;
const isoDay = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const dollars = (cents: number) => Math.round(cents) / 100;

export type AnalyticsData = ReturnType<typeof getAnalyticsData>;

export function getAnalyticsData(db: DB) {
  const now = Date.now();
  const products = db.select().from(t.products).all();
  const sales = db.select().from(t.sales).all();
  const items = db.select().from(t.saleItems).all();
  const recalls = db.select().from(t.recalls).all();
  const cases = db.select().from(t.recallCases).all();
  const saleById = new Map(sales.map((s) => [s.id, s]));

  return {
    asOf: new Date(now).toISOString(),
    products: products.map((p) => ({
      sku: p.sku,
      name: p.name,
      brand: p.brand ?? "",
      model: p.model ?? "",
      unitPrice: dollars(p.unitPriceCents),
    })),
    sales: sales.map((s) => {
      const ageDays = Math.floor((now - s.capturedAt.getTime()) / DAY);
      return {
        id: s.id,
        channel: s.captureId ? "PayPal capture" : "Imported history",
        buyer: s.buyerName ?? "",
        city: s.shipAddress?.city ?? "",
        state: s.shipAddress?.state ?? "",
        total: dollars(s.totalCents),
        soldAt: isoDay(s.capturedAt),
        ageDays,
        // What a refund would have to go through today: PayPal refunds stop after 180 days.
        refundRoute: s.captureId && ageDays <= REFUND_WINDOW_DAYS ? "PayPal refund" : "PayPal payout",
      };
    }),
    saleItems: items.map((i) => ({
      id: String(i.id),
      saleId: i.saleId,
      sku: i.sku,
      quantity: i.quantity,
      unitPrice: dollars(i.unitPriceCents),
      lineTotal: dollars(i.unitPriceCents * i.quantity),
    })),
    recalls: recalls.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      openedAt: isoDay(r.createdAt),
    })),
    cases: cases.map((c) => {
      const sale = saleById.get(c.saleId);
      const remedy = c.chosenRemedy ?? c.recommendedRemedy;
      const moneyCents = c.resolution?.amountCents ?? (remedy === "refund" ? c.refundAmountCents : 0);
      return {
        id: String(c.id),
        recallId: c.recallId,
        saleId: c.saleId,
        sku: c.sku,
        buyerState: sale?.shipAddress?.state ?? "",
        units: c.quantity,
        exposure: dollars(c.refundAmountCents),
        remedy,
        recommendedRemedy: c.recommendedRemedy,
        rail: RAIL_LABEL[c.refundRail],
        status: STATUS_LABEL[c.status],
        statusRank: STATUS_ORDER.indexOf(c.status) + 1,
        refunded: c.status === "resolved" ? dollars(moneyCents) : 0,
        inFlight: c.status === "processing" ? dollars(moneyCents) : 0,
        isResolved: c.status === "resolved",
        notifiedAt: isoDay(c.notifiedAt),
        resolvedAt: isoDay(c.resolvedAt),
        daysToResolve:
          c.resolvedAt && c.createdAt ? Math.max(0, Math.round((c.resolvedAt.getTime() - c.createdAt.getTime()) / DAY)) : null,
      };
    }),
  };
}

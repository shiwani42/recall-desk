import type { RefundRail, Remedy, Severity } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";

// PayPal only allows refunds against a capture for 180 days.
export const PAYPAL_REFUND_WINDOW_DAYS = 180;
// Below this unit value, a refund is cheaper than shipping a replacement or repair kit.
export const LOW_VALUE_CENTS = 2000;

const DAY_MS = 864e5;

export function refundRail(o: { capturedAt: Date; hasCapture: boolean; now: Date }): RefundRail {
  const ageDays = (o.now.getTime() - o.capturedAt.getTime()) / DAY_MS;
  return o.hasCapture && ageDays <= PAYPAL_REFUND_WINDOW_DAYS ? "paypal_refund" : "payout";
}

export type RecommendInput = {
  severity: Severity;
  allowed: Remedy[];
  unitPriceCents: number;
  quantity: number;
  /** null = unlimited */
  replacementStockLeft: number | null;
  capturedAt: Date;
  hasCapture: boolean;
  now: Date;
};

export type Recommendation = { remedy: Remedy; refundRail: RefundRail; reason: string };

export function recommendRemedy(i: RecommendInput): Recommendation {
  if (i.allowed.length === 0) throw new Error("Recall offers no remedies");
  const rail = refundRail(i);
  const can = (r: Remedy) => i.allowed.includes(r);
  const stockOk = i.replacementStockLeft === null || i.replacementStockLeft >= i.quantity;

  const pick = (remedy: Remedy, reason: string): Recommendation => {
    if (remedy === "refund" && rail === "payout") {
      const days = Math.floor((i.now.getTime() - i.capturedAt.getTime()) / DAY_MS);
      reason += i.hasCapture
        ? ` Sold ${days} days ago, past PayPal's ${PAYPAL_REFUND_WINDOW_DAYS}-day refund window, so the money is sent as a PayPal payout.`
        : " No PayPal capture on file for this sale, so the money is sent as a PayPal payout.";
    }
    return { remedy, refundRail: rail, reason };
  };

  if (i.allowed.length === 1) return pick(i.allowed[0], "Only remedy offered by this recall.");
  if (i.severity === "high" && can("refund"))
    return pick("refund", "High-severity hazard: a refund gets the unit out of use fastest, with nothing new to ship.");
  if (i.unitPriceCents < LOW_VALUE_CENTS && can("refund"))
    return pick("refund", `Low-value item (${formatMoney(i.unitPriceCents)}): refunding costs less than shipping a replacement or repair kit.`);
  if (can("replace") && stockOk)
    return pick("replace", i.replacementStockLeft === null ? "Replacement available." : `Replacement in stock (${i.replacementStockLeft} left).`);
  if (can("repair")) return pick("repair", "Repair kit fixes the defect; the buyer keeps their product.");
  if (can("refund")) return pick("refund", "Replacements are out of stock.");
  return pick(i.allowed[0], "Fallback: first remedy offered.");
}

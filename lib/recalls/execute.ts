import { and, eq, ne, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { Remedy, Resolution } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { describePayPalError } from "@/lib/paypal/orders";
import { refundCapture, sendPayout } from "@/lib/paypal/payments";
import { logEvent } from "./service";
import { outcomeForPayout, outcomeForRefund } from "./sync";

export type Actor = "seller" | "buyer";

export function loadCase(db: DB, caseId: number) {
  const row = db
    .select({ c: t.recallCases, sale: t.sales, item: t.saleItems, recall: t.recalls })
    .from(t.recallCases)
    .innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId))
    .innerJoin(t.saleItems, eq(t.saleItems.id, t.recallCases.saleItemId))
    .innerJoin(t.recalls, eq(t.recalls.id, t.recallCases.recallId))
    .where(eq(t.recallCases.id, caseId))
    .get();
  if (!row) throw new Error(`Case ${caseId} not found`);
  return row;
}

export function replacementUnitsLeft(db: DB, recallId: string, stock: number | null, excludeCaseId: number) {
  if (stock === null) return Infinity;
  const used = db
    .select({ n: sql<number>`coalesce(sum(${t.recallCases.quantity}), 0)` })
    .from(t.recallCases)
    .where(and(eq(t.recallCases.recallId, recallId), eq(t.recallCases.chosenRemedy, "replace"), ne(t.recallCases.id, excludeCaseId)))
    .get()!.n;
  return stock - used;
}

export type ResolveResult = { ok: true; status: string; resolution: Resolution } | { ok: false; error: string };

// Carry out a remedy for one affected unit. Refunds move real (sandbox) money through PayPal.
export async function resolveCase(db: DB, caseId: number, remedy: Remedy, actor: Actor): Promise<ResolveResult> {
  const { c, sale, item, recall } = loadCase(db, caseId);

  if (c.status === "resolved") return { ok: false, error: "This case is already resolved." };
  if (c.status === "processing") return { ok: false, error: "A refund is already on its way for this case." };
  if (c.status === "remedy_selected" && c.chosenRemedy !== "refund")
    return { ok: false, error: `A ${c.chosenRemedy} is already arranged for this case.` };
  if (!recall.remedies.includes(remedy)) return { ok: false, error: `This recall doesn't offer ${remedy}.` };
  if (remedy === "replace" && replacementUnitsLeft(db, recall.id, recall.replacementStock, caseId) < c.quantity)
    return { ok: false, error: "Replacement units are out of stock." };

  if (remedy !== "refund") {
    const resolution: Resolution = { remedy, shipTo: sale.shipAddress ?? undefined };
    db.update(t.recallCases)
      .set({ chosenRemedy: remedy, status: "remedy_selected", resolution })
      .where(eq(t.recallCases.id, caseId))
      .run();
    logEvent(db, caseId, `${remedy}_selected`, `by ${actor}; ship to ${sale.shipAddress?.city ?? "address on file"}`);
    return { ok: true, status: "remedy_selected", resolution };
  }

  const note = `Recall ${recall.id} (${recall.title}): refund for ${c.quantity}× ${item.name}.`;
  let resolution: Resolution;
  try {
    if (c.refundRail === "paypal_refund" && sale.captureId) {
      const r = await refundCapture({
        captureId: sale.captureId,
        amountCents: c.refundAmountCents,
        currency: sale.currency,
        note,
        idempotencyKey: `recall-${recall.id}-case-${caseId}-refund`,
      });
      resolution = { remedy, rail: "paypal_refund", paypalRefundId: r.refundId, paypalStatus: r.status, amountCents: c.refundAmountCents };
    } else {
      if (!sale.buyerEmail) return { ok: false, error: "No buyer email on file to send a payout to." };
      const p = await sendPayout({
        batchId: `recall-${recall.id}-case-${caseId}`,
        email: sale.buyerEmail,
        amountCents: c.refundAmountCents,
        currency: sale.currency,
        subject: `Refund for recalled ${item.name}`,
        note,
      });
      resolution = { remedy, rail: "payout", paypalPayoutBatchId: p.batchId, paypalStatus: p.status, amountCents: c.refundAmountCents };
    }
  } catch (err) {
    const raw = describePayPalError(err);
    const error = /CAPTURE_FULLY_REFUNDED/.test(raw)
      ? "PayPal says this payment was already fully refunded (e.g. through a dispute). Offer a replacement or repair instead."
      : /REFUND_AMOUNT_EXCEEDED|REFUND_TIME_LIMIT_EXCEEDED/.test(raw)
        ? `PayPal can't refund this capture (${raw.match(/[A-Z_]{8,}/)?.[0]}). Offer a replacement or repair instead.`
        : raw;
    db.update(t.recallCases)
      .set({ chosenRemedy: remedy, status: "failed", resolution: { remedy, rail: c.refundRail, error } })
      .where(eq(t.recallCases.id, caseId))
      .run();
    logEvent(db, caseId, "refund_failed", error);
    return { ok: false, error };
  }

  // Refunds usually complete instantly; payouts start PENDING and are settled by syncCase / webhooks.
  const outcome = resolution.rail === "payout"
    ? outcomeForPayout(null, resolution.paypalStatus ?? "PENDING")
    : outcomeForRefund(resolution.paypalStatus ?? "PENDING");
  if (outcome.note && outcome.status !== "resolved") resolution.note = outcome.note;
  const failed = outcome.status === "failed";
  db.update(t.recallCases)
    .set({ chosenRemedy: remedy, status: outcome.status, resolution, resolvedAt: outcome.status === "resolved" ? new Date() : null })
    .where(eq(t.recallCases.id, caseId))
    .run();
  logEvent(
    db,
    caseId,
    failed ? "refund_failed" : resolution.rail === "payout" ? "payout_sent" : "refunded",
    `${formatMoney(c.refundAmountCents, sale.currency)} via ${resolution.rail === "payout" ? "PayPal payout" : "PayPal refund"} (${resolution.paypalRefundId ?? resolution.paypalPayoutBatchId}, ${resolution.paypalStatus}) by ${actor}`,
  );
  return failed ? { ok: false, error: `PayPal reported ${resolution.paypalStatus}` } : { ok: true, status: outcome.status, resolution };
}

// Seller confirms a replacement / repair kit has shipped.
export function markShipped(db: DB, caseId: number, tracking?: string) {
  const { c } = loadCase(db, caseId);
  if (c.status !== "remedy_selected" || c.chosenRemedy === "refund") throw new Error("Nothing to ship for this case.");
  const resolution: Resolution = { ...c.resolution!, note: tracking ? `Tracking: ${tracking}` : "Shipped" };
  db.update(t.recallCases).set({ status: "resolved", resolution, resolvedAt: new Date() }).where(eq(t.recallCases.id, caseId)).run();
  logEvent(db, caseId, "shipped", tracking ?? "");
}

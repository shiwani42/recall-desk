import { and, eq, or, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { CaseStatus, Resolution } from "@/lib/db/schema";
import { describePayPalError } from "@/lib/paypal/orders";
import { getPayoutStatus, getRefundStatus } from "@/lib/paypal/payments";
import { logEvent } from "./service";

type Outcome = { status: CaseStatus; note?: string };

// Map PayPal's money-movement status to a case status. Pure, so it's unit-tested.
export function outcomeForRefund(paypalStatus: string): Outcome {
  if (paypalStatus === "COMPLETED") return { status: "resolved" };
  if (paypalStatus === "PENDING") return { status: "processing", note: "PayPal is still processing this refund." };
  return { status: "failed", note: `Refund ${paypalStatus.toLowerCase()}. Offer another remedy.` };
}

export function outcomeForPayout(itemStatus: string | null, batchStatus: string): Outcome {
  switch (itemStatus ?? batchStatus) {
    case "SUCCESS":
      return { status: "resolved" };
    case "UNCLAIMED":
      return {
        status: "processing",
        note: "Buyer has no PayPal account on that email yet. PayPal emailed them a claim link; unclaimed money returns to you after 30 days.",
      };
    case "PENDING":
    case "PROCESSING":
    case "ONHOLD":
      return { status: "processing", note: "PayPal is still processing this payout." };
    case "RETURNED":
      return { status: "failed", note: "Payout went unclaimed for 30 days and was returned to you. Offer another remedy." };
    default:
      return { status: "failed", note: `Payout ${(itemStatus ?? batchStatus).toLowerCase()}. Offer another remedy.` };
  }
}

// Ask PayPal for the current state of one case's refund / payout and update it.
export async function syncCase(db: DB, caseId: number): Promise<{ changed: boolean; status: CaseStatus; error?: string }> {
  const c = db.select().from(t.recallCases).where(eq(t.recallCases.id, caseId)).get();
  if (!c) throw new Error(`Case ${caseId} not found`);
  const res = c.resolution;
  if (!res || res.remedy !== "refund" || !(res.paypalRefundId || res.paypalPayoutBatchId)) return { changed: false, status: c.status };

  let paypalStatus: string;
  let outcome: Outcome;
  try {
    if (res.paypalRefundId) {
      paypalStatus = await getRefundStatus(res.paypalRefundId);
      outcome = outcomeForRefund(paypalStatus);
    } else {
      const p = await getPayoutStatus(res.paypalPayoutBatchId!);
      paypalStatus = p.itemStatus ?? p.batchStatus;
      outcome = outcomeForPayout(p.itemStatus, p.batchStatus);
      if (p.error && outcome.status === "failed") outcome.note += ` (${p.error})`;
    }
  } catch (err) {
    return { changed: false, status: c.status, error: describePayPalError(err) };
  }

  const changed = paypalStatus !== res.paypalStatus || outcome.status !== c.status;
  if (changed) {
    const resolution: Resolution = { ...res, paypalStatus, note: outcome.note };
    db.update(t.recallCases)
      .set({ status: outcome.status, resolution, resolvedAt: outcome.status === "resolved" ? (c.resolvedAt ?? new Date()) : null })
      .where(eq(t.recallCases.id, caseId))
      .run();
    logEvent(db, caseId, "paypal_status", `${res.paypalStatus ?? "?"} → ${paypalStatus} (case ${c.status} → ${outcome.status})`);
  }
  return { changed, status: outcome.status };
}

// Sync every case whose money may still be moving.
export async function syncRecall(db: DB, recallId: string) {
  const ids = db
    .select({ id: t.recallCases.id })
    .from(t.recallCases)
    .where(
      and(
        eq(t.recallCases.recallId, recallId),
        or(
          eq(t.recallCases.status, "processing"),
          and(eq(t.recallCases.status, "resolved"), eq(t.recallCases.chosenRemedy, "refund"), sql`json_extract(${t.recallCases.resolution}, '$.paypalStatus') != 'COMPLETED' and json_extract(${t.recallCases.resolution}, '$.paypalStatus') != 'SUCCESS'`),
        ),
      ),
    )
    .all();
  let changed = 0;
  const errors: string[] = [];
  for (const { id } of ids) {
    const r = await syncCase(db, id);
    if (r.changed) changed++;
    if (r.error) errors.push(`#${id}: ${r.error}`);
  }
  return { checked: ids.length, changed, errors };
}

// For webhooks: find the case that owns a PayPal refund or payout.
export function caseIdForPayPalRef(db: DB, ref: { refundId?: string; payoutBatchId?: string }): number | null {
  const conds = [
    ref.refundId ? sql`json_extract(${t.recallCases.resolution}, '$.paypalRefundId') = ${ref.refundId}` : undefined,
    ref.payoutBatchId ? sql`json_extract(${t.recallCases.resolution}, '$.paypalPayoutBatchId') = ${ref.payoutBatchId}` : undefined,
  ].filter(Boolean);
  if (!conds.length) return null;
  return db.select({ id: t.recallCases.id }).from(t.recallCases).where(or(...conds)).get()?.id ?? null;
}


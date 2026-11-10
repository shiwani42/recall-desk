import { PaymentsController } from "@paypal/paypal-server-sdk";
import { PAYPAL_API_BASE, getAccessToken, getPayPalClient } from "./client";
import { fromCents } from "@/lib/money";

let payments: PaymentsController | undefined;
const paymentsController = () => (payments ??= new PaymentsController(getPayPalClient()));

// Partial refund against the original capture: only the recalled line, not the whole cart.
export async function refundCapture(o: {
  captureId: string;
  amountCents: number;
  currency: string;
  note: string;
  idempotencyKey: string;
}) {
  const { result } = await paymentsController().refundCapturedPayment({
    captureId: o.captureId,
    paypalRequestId: o.idempotencyKey, // same key → PayPal returns the same refund, never a second one
    prefer: "return=representation",
    body: {
      amount: { currencyCode: o.currency, value: fromCents(o.amountCents) },
      noteToPayer: o.note.slice(0, 255),
    },
  });
  return { refundId: result.id!, status: result.status ?? "UNKNOWN" };
}

// Payouts: for sales past PayPal's 180-day refund window (or with no capture on file).
// Not wrapped by the server SDK, so this calls the REST API directly.
export async function sendPayout(o: {
  batchId: string;
  email: string;
  amountCents: number;
  currency: string;
  subject: string;
  note: string;
}) {
  const res = await fetch(`${PAYPAL_API_BASE}/v1/payments/payouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender_batch_header: { sender_batch_id: o.batchId, email_subject: o.subject, email_message: o.note },
      items: [
        {
          recipient_type: "EMAIL",
          receiver: o.email,
          amount: { value: fromCents(o.amountCents), currency: o.currency },
          note: o.note.slice(0, 4000),
          sender_item_id: o.batchId,
        },
      ],
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    batch_header?: { payout_batch_id: string; batch_status: string };
    name?: string;
    message?: string;
  };
  if (!res.ok || !body.batch_header) {
    throw new Error(`PayPal payout ${res.status}: ${body.name ?? "error"}${body.message ? ` — ${body.message}` : ""}`);
  }
  return { batchId: body.batch_header.payout_batch_id, status: body.batch_header.batch_status };
}

export async function getRefundStatus(refundId: string): Promise<string> {
  const { result } = await paymentsController().getRefund({ refundId });
  return result.status ?? "UNKNOWN";
}

// Payout item status: SUCCESS, UNCLAIMED, PENDING, ONHOLD, RETURNED, FAILED, BLOCKED, REFUNDED, REVERSED, DENIED.
export async function getPayoutStatus(batchId: string): Promise<{ batchStatus: string; itemStatus: string | null; error?: string }> {
  const res = await fetch(`${PAYPAL_API_BASE}/v1/payments/payouts/${encodeURIComponent(batchId)}`, {
    headers: { Authorization: `Bearer ${await getAccessToken()}` },
    cache: "no-store",
  });
  const body = (await res.json()) as {
    batch_header?: { batch_status: string };
    items?: { transaction_status?: string; errors?: { name?: string; message?: string } }[];
    name?: string;
    message?: string;
  };
  if (!res.ok) throw new Error(`PayPal payout lookup ${res.status}: ${body.name ?? "error"}`);
  const item = body.items?.[0];
  return {
    batchStatus: body.batch_header?.batch_status ?? "UNKNOWN",
    itemStatus: item?.transaction_status ?? null,
    error: item?.errors ? `${item.errors.name}: ${item.errors.message}` : undefined,
  };
}

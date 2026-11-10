import { PAYPAL_API_BASE, getAccessToken } from "@/lib/paypal/client";
import { getDb } from "@/lib/db";
import { caseIdForPayPalRef, syncCase } from "@/lib/recalls/sync";

// PayPal webhook receiver: keeps recall refunds / payouts in sync without polling.
//
// Setup: Developer Dashboard → your app → Webhooks → add
//   https://<your-public-url>/api/paypal/webhook
// subscribe to PAYMENT.CAPTURE.REFUNDED, PAYMENT.REFUND.*, PAYMENT.PAYOUTS-ITEM.*,
// then put the Webhook ID in PAYPAL_WEBHOOK_ID. For local dev, expose port 3000
// with a tunnel (cloudflared, ngrok). PayPal can't reach localhost.

type WebhookEvent = {
  id: string;
  event_type: string;
  resource?: { id?: string; payout_batch_id?: string; [k: string]: unknown };
};

async function verifySignature(req: Request, event: WebhookEvent): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  const h = req.headers;
  const res = await fetch(`${PAYPAL_API_BASE}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await getAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: h.get("paypal-auth-algo"),
      cert_url: h.get("paypal-cert-url"),
      transmission_id: h.get("paypal-transmission-id"),
      transmission_sig: h.get("paypal-transmission-sig"),
      transmission_time: h.get("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    }),
    cache: "no-store",
  });
  if (!res.ok) return false;
  const { verification_status } = (await res.json()) as { verification_status: string };
  return verification_status === "SUCCESS";
}

export async function POST(req: Request) {
  let event: WebhookEvent;
  try {
    event = (await req.json()) as WebhookEvent;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    if (!(await verifySignature(req, event))) {
      return Response.json({ error: "signature verification failed" }, { status: 401 });
    }
  } catch (err) {
    console.error("[paypal webhook] verification error:", err);
    return Response.json({ error: "verification error" }, { status: 500 });
  }

  // Events can arrive more than once or out of order. syncCase re-reads PayPal's
  // current state, so handling is idempotent regardless.
  const r = event.resource ?? {};
  let caseId: number | null = null;
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    caseId = caseIdForPayPalRef(getDb(), { payoutBatchId: r.payout_batch_id });
  } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type.startsWith("PAYMENT.REFUND.")) {
    caseId = caseIdForPayPalRef(getDb(), { refundId: r.id });
  }

  if (caseId) {
    const s = await syncCase(getDb(), caseId);
    console.log(`[paypal webhook] ${event.event_type} → case ${caseId}: ${s.status}${s.error ? ` (${s.error})` : ""}`);
  } else {
    console.log("[paypal webhook] no recall case for", event.event_type, r.id ?? r.payout_batch_id ?? "");
  }
  return Response.json({ received: true }); // 2xx quickly, or PayPal retries
}

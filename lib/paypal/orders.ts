import {
  ApiError,
  CheckoutPaymentIntent,
  ItemCategory,
  OrdersController,
  type Order,
  type OrderRequest,
} from "@paypal/paypal-server-sdk";
import { getPayPalClient } from "./client";
import { fromCents } from "@/lib/money";

let orders: OrdersController | undefined;
export const ordersController = () => (orders ??= new OrdersController(getPayPalClient()));

export type LineItem = { sku: string; name: string; description?: string; unitPriceCents: number; quantity: number };

// Every order carries SKU-level line items. That itemization is what makes
// recalls possible later: PayPal knows exactly which buyer got which SKU.
export function buildOrderRequest(items: LineItem[], currency = "USD"): OrderRequest {
  const totalCents = items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
  const money = (cents: number) => ({ currencyCode: currency, value: fromCents(cents) });
  return {
    intent: CheckoutPaymentIntent.Capture,
    purchaseUnits: [
      {
        amount: { ...money(totalCents), breakdown: { itemTotal: money(totalCents) } },
        items: items.map((i) => ({
          name: i.name,
          description: i.description?.slice(0, 127),
          sku: i.sku,
          quantity: String(i.quantity),
          unitAmount: money(i.unitPriceCents),
          category: ItemCategory.PhysicalGoods, // physical → PayPal collects a shipping address
        })),
      },
    ],
  };
}

export async function createPayPalOrder(items: LineItem[]): Promise<string> {
  const { result } = await ordersController().createOrder({
    body: buildOrderRequest(items),
    paypalRequestId: crypto.randomUUID(), // idempotency key
  });
  if (!result.id) throw new Error("PayPal order creation failed: missing order ID");
  return result.id;
}

// Returns the full order (items, payer, shipping, capture) so we can record the sale.
export async function capturePayPalOrder(orderId: string): Promise<Order> {
  const { result } = await ordersController().captureOrder({
    id: orderId,
    paypalRequestId: `capture-${orderId}`,
    prefer: "return=representation",
  });
  return result;
}

export function describePayPalError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.result as { name?: string; message?: string; details?: { issue?: string }[] } | undefined;
    const issue = body?.details?.[0]?.issue;
    return `PayPal ${err.statusCode}: ${issue ?? body?.name ?? "error"}${body?.message ? ` — ${body.message}` : ""}`;
  }
  return err instanceof Error ? err.message : String(err);
}

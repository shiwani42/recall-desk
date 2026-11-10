import type { Order } from "@paypal/paypal-server-sdk";
import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { ShipAddress } from "@/lib/db/schema";
import { toCents } from "@/lib/money";

export type SaleSource = (typeof t.sales.$inferInsert)["source"];

export type SaleInput = {
  source: SaleSource;
  paypalOrderId?: string | null;
  captureId?: string | null;
  buyerName?: string | null;
  buyerEmail?: string | null;
  shipAddress?: ShipAddress | null;
  currency: string;
  capturedAt: Date;
  items: { sku: string; name: string; quantity: number; unitPriceCents: number }[];
};

// Turn a captured PayPal order into the SKU-level sale we need for recalls.
export function saleFromPayPalOrder(order: Order, source: SaleSource): SaleInput {
  const unit = order.purchaseUnits?.[0];
  const capture = unit?.payments?.captures?.[0];
  if (!order.id || !unit || !capture?.id) throw new Error("Order has no completed capture");

  const addr = unit.shipping?.address;
  const payerName = [order.payer?.name?.givenName, order.payer?.name?.surname].filter(Boolean).join(" ");

  return {
    source,
    paypalOrderId: order.id,
    captureId: capture.id,
    buyerName: payerName || unit.shipping?.name?.fullName || null,
    buyerEmail: order.payer?.emailAddress ?? null,
    shipAddress: addr
      ? {
          name: unit.shipping?.name?.fullName,
          line1: addr.addressLine1,
          line2: addr.addressLine2,
          city: addr.adminArea2,
          state: addr.adminArea1,
          postalCode: addr.postalCode,
          countryCode: addr.countryCode,
        }
      : null,
    currency: capture.amount?.currencyCode ?? unit.amount?.currencyCode ?? "USD",
    capturedAt: capture.createTime ? new Date(capture.createTime) : new Date(),
    items: (unit.items ?? []).map((i) => ({
      sku: i.sku ?? "UNKNOWN",
      name: i.name,
      quantity: Number(i.quantity) || 1,
      unitPriceCents: toCents(i.unitAmount?.value),
    })),
  };
}

// Idempotent on captureId: recording the same capture twice is a no-op.
export function recordSale(db: DB, input: SaleInput): { id: string; created: boolean } {
  return db.transaction((tx) => {
    const id = randomUUID();
    const totalCents = input.items.reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    const inserted = tx
      .insert(t.sales)
      .values({
        id,
        source: input.source,
        paypalOrderId: input.paypalOrderId ?? null,
        captureId: input.captureId ?? null,
        buyerName: input.buyerName ?? null,
        buyerEmail: input.buyerEmail ?? null,
        shipAddress: input.shipAddress ?? null,
        totalCents,
        currency: input.currency,
        capturedAt: input.capturedAt,
      })
      .onConflictDoNothing({ target: t.sales.captureId })
      .returning({ id: t.sales.id })
      .all();

    if (inserted.length === 0) {
      const existing = tx.query.sales.findFirst({ where: (s, { eq }) => eq(s.captureId, input.captureId!) }).sync();
      return { id: existing!.id, created: false };
    }
    if (input.items.length) {
      tx.insert(t.saleItems).values(input.items.map((i) => ({ ...i, saleId: id }))).run();
    }
    return { id, created: true };
  });
}

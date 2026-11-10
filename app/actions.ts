"use server";

import { z } from "zod";
import { getDb } from "@/lib/db";
import { getProduct } from "@/lib/products";
import { capturePayPalOrder, createPayPalOrder, describePayPalError } from "@/lib/paypal/orders";
import { recordSale, saleFromPayPalOrder } from "@/lib/sales";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export type CaptureSummary = {
  orderId: string;
  captureId: string;
  amount: string;
  currency: string;
  buyerName: string | null;
  saleId: string;
};

// Server Actions are public HTTP endpoints — validate every input.

export async function createOrder(sku: string): Promise<Result<{ id: string }>> {
  const product = getProduct(z.string().max(64).parse(sku));
  if (!product) return { ok: false, error: "Unknown product" };
  try {
    const id = await createPayPalOrder([{ ...product, quantity: 1 }]);
    return { ok: true, data: { id } };
  } catch (err) {
    console.error("[paypal] createOrder failed:", err);
    return { ok: false, error: describePayPalError(err) };
  }
}

export async function captureOrder(orderId: string): Promise<Result<CaptureSummary>> {
  if (!z.string().regex(/^[A-Z0-9]{10,40}$/).safeParse(orderId).success) {
    return { ok: false, error: "Invalid order ID" };
  }
  try {
    const order = await capturePayPalOrder(orderId);
    const sale = saleFromPayPalOrder(order, "checkout");
    const { id: saleId } = recordSale(getDb(), sale);
    const capture = order.purchaseUnits?.[0]?.payments?.captures?.[0];
    return {
      ok: true,
      data: {
        orderId,
        captureId: sale.captureId!,
        amount: capture?.amount?.value ?? "",
        currency: sale.currency,
        buyerName: sale.buyerName ?? null,
        saleId,
      },
    };
  } catch (err) {
    console.error("[paypal] captureOrder failed:", err);
    return { ok: false, error: describePayPalError(err) };
  }
}

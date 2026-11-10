import type { TransactionDetails } from "@paypal/paypal-server-sdk";
import type { DB } from "@/lib/db";
import { toCents } from "@/lib/money";
import { recordSale, type SaleInput } from "@/lib/sales";

// PayPal transaction event codes: T00xx = payment received; refunds/reversals reference the original.
const isPayment = (code?: string) => Boolean(code?.startsWith("T00"));
const isRefundLike = (code?: string) => Boolean(code && /^T1(1|2)\d\d$/.test(code)); // T11xx reversals/refunds, T12xx adjustments/chargebacks

export type ImportSummary = {
  scanned: number;
  imported: number;
  alreadyInLedger: number;
  skippedNoItems: number;
  skippedFullyRefunded: number;
  skippedOther: number;
  lastRefreshed: string | null;
};

export function saleFromTransaction(t: TransactionDetails): SaleInput | null {
  const info = t.transactionInfo;
  if (!info?.transactionId || !isPayment(info.transactionEventCode)) return null;
  if (!["S", "P"].includes(info.transactionStatus ?? "")) return null; // success / pending only
  const amountCents = toCents(info.transactionAmount?.value);
  if (amountCents <= 0) return null;

  const items = (t.cartInfo?.itemDetails ?? []).map((i) => {
    const quantity = Math.max(1, Math.round(Number(i.itemQuantity) || 1));
    const unit = toCents(i.itemUnitPrice?.value) || Math.round(toCents(i.itemAmount?.value) / quantity);
    return { sku: i.itemCode?.trim() || "NO-SKU", name: i.itemName?.trim() || "Unnamed item", quantity, unitPriceCents: unit };
  });

  const name = t.payerInfo?.payerName;
  const addr = t.shippingInfo?.address;
  return {
    source: "paypal_import",
    captureId: info.transactionId,
    buyerName:
      name?.alternateFullName || [name?.givenName, name?.surname].filter(Boolean).join(" ") || t.shippingInfo?.name || null,
    buyerEmail: t.payerInfo?.emailAddress ?? null,
    shipAddress: addr
      ? { name: t.shippingInfo?.name, line1: addr.line1, line2: addr.line2, city: addr.city, state: addr.state, postalCode: addr.postalCode, countryCode: addr.countryCode }
      : null,
    currency: info.transactionAmount?.currencyCode ?? "USD",
    capturedAt: new Date(info.transactionInitiationDate ?? Date.now()),
    items,
  };
}

// Pure: turns a batch of PayPal transactions into ledger writes. Exported for tests.
export function importTransactions(db: DB, transactions: TransactionDetails[], lastRefreshed: string | null = null): ImportSummary {
  // Total refunded per original transaction, from refund/reversal events that reference it.
  const refunded = new Map<string, number>();
  for (const t of transactions) {
    const i = t.transactionInfo;
    if (isRefundLike(i?.transactionEventCode) && i?.paypalReferenceId) {
      refunded.set(i.paypalReferenceId, (refunded.get(i.paypalReferenceId) ?? 0) + Math.abs(toCents(i.transactionAmount?.value)));
    }
  }

  const s: ImportSummary = { scanned: transactions.length, imported: 0, alreadyInLedger: 0, skippedNoItems: 0, skippedFullyRefunded: 0, skippedOther: 0, lastRefreshed };
  for (const t of transactions) {
    const sale = saleFromTransaction(t);
    if (!sale) {
      if (!isRefundLike(t.transactionInfo?.transactionEventCode)) s.skippedOther++;
      continue;
    }
    if (sale.items.length === 0) {
      s.skippedNoItems++; // e.g. PayPal.me or invoices without line items: can't be matched by SKU
      continue;
    }
    const total = toCents(t.transactionInfo?.transactionAmount?.value);
    if ((refunded.get(sale.captureId!) ?? 0) >= total) {
      s.skippedFullyRefunded++; // money already returned: most likely a return, nothing left to refund
      continue;
    }
    const { created } = recordSale(db, sale);
    if (created) s.imported++;
    else s.alreadyInLedger++;
  }
  return s;
}

import type { TransactionDetails } from "@paypal/paypal-server-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, t, type DB } from "@/lib/db";
import { importTransactions, saleFromTransaction } from "@/lib/importer";
import { createRecall, matchRecall } from "@/lib/recalls/service";

// Fixtures follow PayPal's Transaction Search response (fields=all), as the server SDK models it.
const payment = (id: string, over: Partial<TransactionDetails> = {}, items = [{ itemCode: "HTR-200", itemName: "Heater", itemQuantity: "1", itemUnitPrice: { currencyCode: "USD", value: "49.99" } }]): TransactionDetails => ({
  transactionInfo: {
    transactionId: id,
    transactionEventCode: "T0006",
    transactionStatus: "S",
    transactionInitiationDate: "2026-09-01T10:00:00+0000",
    transactionAmount: { currencyCode: "USD", value: "49.99" },
  },
  payerInfo: { emailAddress: "buyer@example.com", payerName: { givenName: "Ana", surname: "Silva" } },
  shippingInfo: { name: "Ana Silva", address: { line1: "1 Main St", city: "Reno", state: "NV", countryCode: "US", postalCode: "89501" } },
  cartInfo: { itemDetails: items },
  ...over,
});
const refund = (id: string, of: string, value: string): TransactionDetails => ({
  transactionInfo: { transactionId: id, paypalReferenceId: of, transactionEventCode: "T1107", transactionStatus: "S", transactionAmount: { currencyCode: "USD", value } },
});

let db: DB;
beforeEach(() => (db = openDb(":memory:")));

describe("saleFromTransaction", () => {
  it("maps SKU line items, buyer and shipping", () => {
    expect(saleFromTransaction(payment("TX1"))).toMatchObject({
      source: "paypal_import",
      captureId: "TX1",
      buyerName: "Ana Silva",
      buyerEmail: "buyer@example.com",
      shipAddress: { city: "Reno", state: "NV" },
      items: [{ sku: "HTR-200", name: "Heater", quantity: 1, unitPriceCents: 4999 }],
    });
  });
  it("ignores refunds, withdrawals and failed payments", () => {
    expect(saleFromTransaction(refund("R1", "TX1", "-49.99"))).toBeNull();
    expect(saleFromTransaction(payment("TX2", { transactionInfo: { ...payment("x").transactionInfo, transactionEventCode: "T0400" } }))).toBeNull();
    expect(saleFromTransaction(payment("TX3", { transactionInfo: { ...payment("x").transactionInfo, transactionStatus: "D" } }))).toBeNull();
  });
  it("derives unit price from line amount when missing, and labels missing SKUs", () => {
    const s = saleFromTransaction(payment("TX4", {}, [{ itemName: "Mystery", itemQuantity: "2", itemAmount: { currencyCode: "USD", value: "20.00" } } as never]));
    expect(s!.items).toEqual([{ sku: "NO-SKU", name: "Mystery", quantity: 2, unitPriceCents: 1000 }]);
  });
});

describe("importTransactions", () => {
  it("imports itemized payments, dedupes, and skips what can't be recalled", () => {
    const batch = [
      payment("TX1"),
      payment("TX2"),
      refund("R2", "TX2", "-49.99"), // TX2 fully refunded → skip
      payment("TX3"),
      refund("R3", "TX3", "-10.00"), // partial refund → still import
      payment("TX4", { cartInfo: { itemDetails: [] } }), // no items
      payment("TX5", { transactionInfo: { ...payment("x").transactionInfo, transactionId: "TX5", transactionEventCode: "T0400" } }), // withdrawal
    ];
    expect(importTransactions(db, batch, "2026-11-10T07:59:59Z")).toEqual({
      scanned: 7, imported: 2, alreadyInLedger: 0, skippedNoItems: 1, skippedFullyRefunded: 1, skippedOther: 1, lastRefreshed: "2026-11-10T07:59:59Z",
    });
    expect(importTransactions(db, batch)).toMatchObject({ imported: 0, alreadyInLedger: 2 });
  });

  it("imported sales are picked up by an existing recall on rescan", () => {
    const { id } = createRecall(db, { title: "Heater", hazard: "fire", severity: "high", skus: ["HTR-200"], remedies: ["refund"] });
    importTransactions(db, [payment("TX9")]);
    expect(matchRecall(db, id)).toMatchObject({ newCases: 1 });
    expect(db.select().from(t.recallCases).all()[0].sku).toBe("HTR-200");
  });
});

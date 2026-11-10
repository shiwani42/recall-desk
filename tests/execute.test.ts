import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, t, type DB } from "@/lib/db";
import { markShipped, resolveCase } from "@/lib/recalls/execute";
import { createRecall } from "@/lib/recalls/service";
import { recordSale } from "@/lib/sales";

// Non-refund paths only — refunds hit PayPal and are verified against the sandbox separately.
let db: DB;
let recallId: string;
const caseFor = (buyer: string) =>
  db.select({ id: t.recallCases.id }).from(t.recallCases).innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId)).where(eq(t.sales.buyerName, buyer)).get()!.id;

beforeEach(() => {
  db = openDb(":memory:");
  for (const [buyer, qty] of [["ann", 1], ["bob", 1], ["cat", 2]] as const) {
    recordSale(db, {
      source: "seed", captureId: `CAP-${buyer}`, buyerName: buyer, buyerEmail: `${buyer}@example.com`, currency: "USD",
      capturedAt: new Date(), shipAddress: { city: "Austin", countryCode: "US" },
      items: [{ sku: "KTL-1L", name: "Kettle", quantity: qty, unitPriceCents: 2499 }],
    });
  }
  recallId = createRecall(db, {
    title: "Kettle", hazard: "lid", severity: "low", skus: ["KTL-1L"], remedies: ["replace", "repair"], replacementStock: 2,
  }).id;
});

describe("resolveCase (replace / repair)", () => {
  it("arranges a replacement with the buyer's shipping address, then marks it shipped", async () => {
    const id = caseFor("ann");
    const r = await resolveCase(db, id, "replace", "buyer");
    expect(r).toMatchObject({ ok: true, status: "remedy_selected", resolution: { remedy: "replace", shipTo: { city: "Austin" } } });
    markShipped(db, id, "1Z999");
    const c = db.select().from(t.recallCases).where(eq(t.recallCases.id, id)).get()!;
    expect(c.status).toBe("resolved");
    expect(c.resolution?.note).toBe("Tracking: 1Z999");
    expect(db.select().from(t.caseEvents).where(eq(t.caseEvents.caseId, id)).all().map((e) => e.type)).toEqual(["identified", "replace_selected", "shipped"]);
  });

  it("enforces replacement stock across buyers", async () => {
    expect((await resolveCase(db, caseFor("ann"), "replace", "buyer")).ok).toBe(true);
    expect((await resolveCase(db, caseFor("bob"), "replace", "buyer")).ok).toBe(true);
    const r = await resolveCase(db, caseFor("cat"), "replace", "buyer"); // needs 2, 0 left
    expect(r).toEqual({ ok: false, error: "Replacement units are out of stock." });
    expect((await resolveCase(db, caseFor("cat"), "repair", "buyer")).ok).toBe(true);
  });

  it("rejects remedies the recall doesn't offer", async () => {
    expect(await resolveCase(db, caseFor("ann"), "refund", "buyer")).toEqual({ ok: false, error: "This recall doesn't offer refund." });
  });

  it("doesn't let a buyer switch after a shipment is arranged", async () => {
    await resolveCase(db, caseFor("ann"), "repair", "buyer");
    expect((await resolveCase(db, caseFor("ann"), "replace", "buyer")).ok).toBe(false);
  });

  it("won't mark a case shipped when nothing is arranged", () => {
    expect(() => markShipped(db, caseFor("bob"))).toThrow();
  });

  it("is scoped to its recall", () => {
    expect(db.select().from(t.recallCases).where(eq(t.recallCases.recallId, recallId)).all()).toHaveLength(3);
  });
});

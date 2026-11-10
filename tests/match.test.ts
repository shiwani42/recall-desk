import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb, t, type DB } from "@/lib/db";
import { createRecall, matchRecall } from "@/lib/recalls/service";
import { recordSale } from "@/lib/sales";

const now = new Date("2026-11-10T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5);
let db: DB;

function sale(buyer: string, items: [string, number, number][], capturedAt: Date, captureId: string | null) {
  return recordSale(db, {
    source: "seed",
    captureId,
    buyerName: buyer,
    buyerEmail: `${buyer}@example.com`,
    currency: "USD",
    capturedAt,
    items: items.map(([sku, quantity, unitPriceCents]) => ({ sku, name: sku, quantity, unitPriceCents })),
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  sale("ann", [["HTR-200", 1, 4999]], daysAgo(5), "CAP1");
  sale("bob", [["HTR-200", 1, 4999], ["CHG-65W", 2, 1999]], daysAgo(20), "CAP2");
  sale("cat", [["CHG-65W", 1, 1999]], daysAgo(400), null);
  sale("dan", [["KTL-1L", 1, 2499]], daysAgo(3), "CAP4");
});

describe("recordSale", () => {
  it("is idempotent on captureId", () => {
    const again = sale("ann", [["HTR-200", 1, 4999]], daysAgo(5), "CAP1");
    expect(again.created).toBe(false);
    expect(db.select().from(t.sales).all()).toHaveLength(4);
  });
});

describe("matchRecall", () => {
  it("finds only the recalled SKU lines, not the whole cart", () => {
    const r = createRecall(db, { title: "Heater", hazard: "fire", severity: "high", skus: ["HTR-200"], remedies: ["refund"] }, now);
    expect(r).toMatchObject({ newCases: 2, totalCases: 2 });
    const cases = db.select().from(t.recallCases).all();
    expect(cases.map((c) => c.sku)).toEqual(["HTR-200", "HTR-200"]);
    expect(cases.every((c) => c.refundAmountCents === 4999)).toBe(true);
  });

  it("refunds only the recalled line amount (qty × unit price)", () => {
    createRecall(db, { title: "Charger", hazard: "overheat", severity: "medium", skus: ["CHG-65W"], remedies: ["refund", "replace"] }, now);
    const bob = db.select().from(t.recallCases).all().find((c) => c.quantity === 2)!;
    expect(bob.refundAmountCents).toBe(3998);
  });

  it("respects the sold-date window", () => {
    const r = createRecall(db, { title: "Charger", hazard: "x", severity: "low", skus: ["CHG-65W"], remedies: ["refund"], soldFrom: daysAgo(30), soldTo: now }, now);
    expect(r.totalCases).toBe(1);
  });

  it("routes old / capture-less sales to payout", () => {
    createRecall(db, { title: "Charger", hazard: "x", severity: "high", skus: ["CHG-65W"], remedies: ["refund"] }, now);
    const rails = db.select().from(t.recallCases).all().map((c) => c.refundRail).sort();
    expect(rails).toEqual(["payout", "paypal_refund"]);
  });

  it("is re-runnable and picks up newly imported sales only", () => {
    const { id } = createRecall(db, { title: "Heater", hazard: "fire", severity: "high", skus: ["HTR-200"], remedies: ["refund"] }, now);
    expect(matchRecall(db, id, now)).toMatchObject({ newCases: 0, totalCases: 2 });
    sale("eve", [["HTR-200", 1, 4999]], daysAgo(1), "CAP5");
    expect(matchRecall(db, id, now)).toMatchObject({ newCases: 1, totalCases: 3 });
  });

  it("stops recommending replacements once stock runs out", () => {
    const { id } = createRecall(db, {
      title: "Heater", hazard: "wobbly", severity: "medium", skus: ["HTR-200"], remedies: ["replace", "repair"], replacementStock: 1,
    }, now);
    const recs = Object.fromEntries(
      db
        .select({ buyer: t.sales.buyerName, remedy: t.recallCases.recommendedRemedy })
        .from(t.recallCases)
        .innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId))
        .where(eq(t.recallCases.recallId, id))
        .all()
        .map((r) => [r.buyer, r.remedy]),
    );
    // bob bought 20 days ago, ann 5 days ago: the oldest sale gets the one replacement unit.
    expect(recs).toEqual({ bob: "replace", ann: "repair" });
  });

  it("logs an audit event for each new case", () => {
    createRecall(db, { title: "Heater", hazard: "fire", severity: "high", skus: ["HTR-200"], remedies: ["refund"] }, now);
    expect(db.select().from(t.caseEvents).all()).toHaveLength(2);
  });
});

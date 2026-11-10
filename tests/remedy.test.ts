import { describe, expect, it } from "vitest";
import { recommendRemedy, refundRail } from "@/lib/recalls/remedy";

const now = new Date("2026-11-10T00:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 864e5);
const base = {
  severity: "medium" as const,
  allowed: ["refund", "replace", "repair"] as ("refund" | "replace" | "repair")[],
  unitPriceCents: 4999,
  quantity: 1,
  replacementStockLeft: 10,
  capturedAt: daysAgo(10),
  hasCapture: true,
  now,
};

describe("refundRail", () => {
  it("uses a PayPal refund inside 180 days", () => {
    expect(refundRail({ capturedAt: daysAgo(180), hasCapture: true, now })).toBe("paypal_refund");
  });
  it("falls back to payout after 180 days", () => {
    expect(refundRail({ capturedAt: daysAgo(181), hasCapture: true, now })).toBe("payout");
  });
  it("uses payout when there is no capture to refund against", () => {
    expect(refundRail({ capturedAt: daysAgo(1), hasCapture: false, now })).toBe("payout");
  });
});

describe("recommendRemedy", () => {
  it("honours a single allowed remedy even for high severity", () => {
    expect(recommendRemedy({ ...base, severity: "high", allowed: ["repair"] }).remedy).toBe("repair");
  });
  it("refunds high-severity hazards", () => {
    expect(recommendRemedy({ ...base, severity: "high" }).remedy).toBe("refund");
  });
  it("refunds low-value items", () => {
    const r = recommendRemedy({ ...base, unitPriceCents: 1299 });
    expect(r.remedy).toBe("refund");
    expect(r.reason).toMatch(/\$12\.99/);
  });
  it("replaces when in stock", () => {
    expect(recommendRemedy(base).remedy).toBe("replace");
  });
  it("treats null stock as unlimited", () => {
    expect(recommendRemedy({ ...base, replacementStockLeft: null }).remedy).toBe("replace");
  });
  it("repairs when replacements can't cover the quantity", () => {
    expect(recommendRemedy({ ...base, quantity: 2, replacementStockLeft: 1 }).remedy).toBe("repair");
  });
  it("refunds when out of stock and repair isn't offered", () => {
    const r = recommendRemedy({ ...base, allowed: ["refund", "replace"], replacementStockLeft: 0 });
    expect(r.remedy).toBe("refund");
  });
  it("explains the payout rail for old sales", () => {
    const r = recommendRemedy({ ...base, severity: "high", capturedAt: daysAgo(240) });
    expect(r).toMatchObject({ remedy: "refund", refundRail: "payout" });
    expect(r.reason).toMatch(/240 days ago/);
  });
  it("rejects a recall with no remedies", () => {
    expect(() => recommendRemedy({ ...base, allowed: [] })).toThrow();
  });
});

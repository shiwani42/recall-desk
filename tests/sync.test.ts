import { describe, expect, it } from "vitest";
import { outcomeForPayout, outcomeForRefund } from "@/lib/recalls/sync";

describe("outcomeForRefund", () => {
  it.each([
    ["COMPLETED", "resolved"],
    ["PENDING", "processing"],
    ["FAILED", "failed"],
    ["CANCELLED", "failed"],
  ])("%s → %s", (paypal, status) => expect(outcomeForRefund(paypal).status).toBe(status));
});

describe("outcomeForPayout", () => {
  it.each([
    ["SUCCESS", "resolved"],
    ["UNCLAIMED", "processing"],
    ["PENDING", "processing"],
    ["ONHOLD", "processing"],
    ["RETURNED", "failed"],
    ["FAILED", "failed"],
    ["BLOCKED", "failed"],
  ])("item %s → %s", (item, status) => expect(outcomeForPayout(item, "SUCCESS").status).toBe(status));

  it("falls back to the batch status before items exist", () => {
    expect(outcomeForPayout(null, "PENDING").status).toBe("processing");
  });
  it("explains unclaimed payouts to the seller", () => {
    expect(outcomeForPayout("UNCLAIMED", "SUCCESS").note).toMatch(/claim link/);
  });
});

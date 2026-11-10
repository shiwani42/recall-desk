import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, t, type DB } from "@/lib/db";
import { setTransportForTests } from "@/lib/email";
import { markShipped, resolveCase } from "@/lib/recalls/execute";
import { notifyBuyers, sendCaseUpdate } from "@/lib/recalls/notify";
import { createRecall } from "@/lib/recalls/service";
import { recordSale } from "@/lib/sales";

let db: DB;
let recallId: string;
beforeEach(() => {
  db = openDb(":memory:");
  recordSale(db, { source: "seed", captureId: "C1", buyerName: "Ann Lee", buyerEmail: "ann@example.com", currency: "USD", capturedAt: new Date(), shipAddress: { line1: "1 Main", city: "Austin" }, items: [{ sku: "KTL-1L", name: "Kettle", quantity: 1, unitPriceCents: 2499 }] });
  recordSale(db, { source: "seed", captureId: "C2", buyerName: "No Email", currency: "USD", capturedAt: new Date(), items: [{ sku: "KTL-1L", name: "Kettle", quantity: 1, unitPriceCents: 2499 }] });
  recallId = createRecall(db, { title: "Kettle lid", hazard: "Lid can detach.", instructions: "Stop using it.", severity: "medium", skus: ["KTL-1L"], remedies: ["replace", "repair"] }).id;
});
afterEach(() => setTransportForTests(undefined as never));

describe("notifyBuyers", () => {
  it("logs notices without SMTP and marks buyers notified once", async () => {
    setTransportForTests(null);
    const r = await notifyBuyers(db, recallId, "http://x.test");
    expect(r).toEqual({ notified: 1, skippedNoEmail: 1, sent: 0, logged: 1, failed: 0 });
    const [m] = db.select().from(t.outbox).all();
    expect(m).toMatchObject({ status: "logged", kind: "notice", to: "ann@example.com" });
    expect(m.body).toMatch(/http:\/\/x\.test\/r\/[\w-]{20,}/);
    expect(m.html).toContain("Choose your remedy");
    expect((await notifyBuyers(db, recallId, "http://x.test")).notified).toBe(0); // idempotent
  });

  it("delivers over SMTP and honours EMAIL_REDIRECT_TO", async () => {
    setTransportForTests(nodemailer.createTransport({ jsonTransport: true }));
    process.env.EMAIL_REDIRECT_TO = "demo@example.org";
    try {
      expect(await notifyBuyers(db, recallId, "http://x.test")).toMatchObject({ sent: 1, failed: 0 });
      expect(db.select().from(t.outbox).get()).toMatchObject({ status: "sent", to: "ann@example.com", deliveredTo: "demo@example.org" });
    } finally {
      delete process.env.EMAIL_REDIRECT_TO;
    }
  });

  it("records delivery failures for retry without losing the notice", async () => {
    setTransportForTests({ sendMail: async () => { throw new Error("SMTP down"); } } as never);
    expect(await notifyBuyers(db, recallId, "http://x.test")).toMatchObject({ notified: 1, failed: 1 });
    expect(db.select().from(t.outbox).get()).toMatchObject({ status: "failed", error: "SMTP down" });
    expect(db.select().from(t.recallCases).all().filter((c) => c.status === "notified")).toHaveLength(1);
  });
});

describe("sendCaseUpdate", () => {
  const annCase = () =>
    db.select({ id: t.recallCases.id }).from(t.recallCases).innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId)).where(eq(t.sales.buyerEmail, "ann@example.com")).get()!.id;

  it("confirms a replacement with the shipping address, then the shipment with tracking", async () => {
    setTransportForTests(null);
    const id = annCase();
    expect((await resolveCase(db, id, "replace", "buyer")).ok).toBe(true);
    await sendCaseUpdate(db, id);
    markShipped(db, id, "1Z999");
    await sendCaseUpdate(db, id);
    const updates = db.select().from(t.outbox).where(eq(t.outbox.kind, "update")).all();
    expect(updates.map((u) => u.subject)).toEqual(["We're sending your replacement", "Your replacement has shipped"]);
    expect(updates[0].body).toContain("1 Main, Austin");
    expect(updates[1].body).toContain("Tracking: 1Z999");
  });

  it("sends nothing for a buyer without email", async () => {
    setTransportForTests(null);
    const other = db.select({ id: t.recallCases.id }).from(t.recallCases).all().find((c) => c.id !== annCase())!.id;
    await resolveCase(db, other, "repair", "seller");
    expect(await sendCaseUpdate(db, other)).toBeNull();
  });
});

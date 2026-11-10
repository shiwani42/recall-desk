import { and, eq, inArray } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { t } from "@/lib/db";
import type { Remedy } from "@/lib/db/schema";
import { deliver } from "@/lib/email";
import { formatMoney } from "@/lib/money";
import { render, type Block } from "./emails";
import { loadCase } from "./execute";

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
const REMEDY_LABEL: Record<Remedy, string> = { refund: "a refund", replace: "a free replacement", repair: "a free repair kit" };
const firstName = (n?: string | null) => n?.split(" ")[0] ?? "there";

export function buyerLink(baseUrl: string, token: string) {
  return `${baseUrl.replace(/\/$/, "")}/r/${token}`;
}

// Notify every affected buyer who hasn't been contacted yet.
export async function notifyBuyers(db: DB, recallId: string, baseUrl: string) {
  const recall = db.select().from(t.recalls).where(eq(t.recalls.id, recallId)).get();
  if (!recall) throw new Error(`Recall ${recallId} not found`);

  const pending = db
    .select({ c: t.recallCases, sale: t.sales, item: t.saleItems })
    .from(t.recallCases)
    .innerJoin(t.sales, eq(t.sales.id, t.recallCases.saleId))
    .innerJoin(t.saleItems, eq(t.saleItems.id, t.recallCases.saleItemId))
    .where(and(eq(t.recallCases.recallId, recallId), eq(t.recallCases.status, "identified")))
    .all();

  const options = recall.remedies.map((r) => REMEDY_LABEL[r]).join(", ").replace(/, ([^,]*)$/, " or $1");
  let skippedNoEmail = 0;
  const queued: number[] = [];

  // 1) Record the notices and mark cases notified atomically…
  db.transaction((tx) => {
    for (const { c, sale, item } of pending) {
      if (!sale.buyerEmail) {
        skippedNoEmail++;
        continue;
      }
      const { text, html } = render([
        { kind: "p", text: `Hi ${firstName(sale.buyerName)},` },
        {
          kind: "alert",
          title: `Safety recall · ${recall.title}`,
          lines: [recall.hazard, ...(recall.instructions ? [recall.instructions] : [])],
        },
        {
          kind: "p",
          text: `On ${fmtDate(sale.capturedAt)} you bought ${c.quantity}× ${item.name}${sale.captureId ? ` (PayPal transaction ${sale.captureId})` : ""}. This product has been recalled. You're entitled to ${options}, at no cost to you.`,
        },
        { kind: "button", label: "Choose your remedy", url: buyerLink(baseUrl, c.buyerToken) },
        { kind: "small", text: `Recall reference ${recall.id}. You're receiving this because this purchase was paid with PayPal.` },
      ]);
      const row = tx
        .insert(t.outbox)
        .values({ caseId: c.id, kind: "notice", to: sale.buyerEmail, subject: `Safety recall: the ${item.name} you bought needs attention`, body: text, html, status: "queued" })
        .returning({ id: t.outbox.id })
        .get();
      queued.push(row.id);
      tx.update(t.recallCases).set({ status: "notified", notifiedAt: new Date() }).where(eq(t.recallCases.id, c.id)).run();
      tx.insert(t.caseEvents).values({ caseId: c.id, type: "notified", detail: `email to ${sale.buyerEmail}` }).run();
    }
  });

  // 2) …then deliver. A delivery failure never loses the notice; it can be retried from the outbox.
  const delivery = await deliverQueued(db, queued);
  return { notified: queued.length, skippedNoEmail, ...delivery };
}

// Tell the buyer what happened after a remedy is executed / shipped.
export async function sendCaseUpdate(db: DB, caseId: number) {
  const { c, sale, item, recall } = loadCase(db, caseId);
  if (!sale.buyerEmail || !c.chosenRemedy) return null;
  const res = c.resolution;
  const amount = formatMoney(c.refundAmountCents, sale.currency);

  let subject: string;
  let lines: Block[];
  if (c.chosenRemedy === "refund") {
    if (c.status === "failed") return null; // the seller handles failures first
    subject = `Your ${amount} refund for the recalled ${item.name}`;
    lines =
      res?.rail === "payout"
        ? [
            { kind: "p", text: `We've sent ${amount} to your PayPal account (${sale.buyerEmail}) for your recalled ${item.name}.` },
            { kind: "p", text: "If you don't have a PayPal account on this email yet, PayPal will email you a link to claim the money." },
          ]
        : [{ kind: "p", text: `We've refunded ${amount} to your original PayPal payment for your recalled ${item.name}. It usually shows up within minutes.` }];
  } else if (c.status === "resolved") {
    subject = `Your ${c.chosenRemedy === "replace" ? "replacement" : "repair kit"} has shipped`;
    lines = [{ kind: "p", text: `Your ${c.chosenRemedy === "replace" ? `replacement ${item.name}` : `repair kit for the ${item.name}`} is on its way.${res?.note?.startsWith("Tracking") ? ` ${res.note}.` : ""}` }];
  } else {
    subject = `We're sending your ${c.chosenRemedy === "replace" ? "replacement" : "repair kit"}`;
    const a = sale.shipAddress;
    lines = [
      {
        kind: "p",
        text: `Thanks. Your ${c.chosenRemedy === "replace" ? `replacement ${item.name}` : `repair kit for the ${item.name}`} will ship to ${[a?.line1, a?.city, a?.state, a?.postalCode].filter(Boolean).join(", ") || "your address on file"}. We'll email tracking when it's on its way.`,
      },
    ];
  }

  const { text, html } = render([
    { kind: "p", text: `Hi ${firstName(sale.buyerName)},` },
    ...lines,
    ...(recall.instructions ? [{ kind: "p" as const, text: `Reminder: ${recall.instructions}` }] : []),
    { kind: "small", text: `Recall reference ${recall.id}.` },
  ]);
  const row = db.insert(t.outbox).values({ caseId, kind: "update", to: sale.buyerEmail, subject, body: text, html, status: "queued" }).returning({ id: t.outbox.id }).get();
  return deliverQueued(db, [row.id]);
}

export async function deliverQueued(db: DB, ids: number[]) {
  const out = { sent: 0, logged: 0, failed: 0 };
  if (ids.length === 0) return out;
  const rows = db.select().from(t.outbox).where(and(inArray(t.outbox.id, ids), inArray(t.outbox.status, ["queued", "failed"]))).all();
  for (const m of rows) {
    const r = await deliver({ to: m.to, subject: m.subject, text: m.body, html: m.html ?? undefined });
    db.update(t.outbox)
      .set({
        status: r.status,
        deliveredTo: r.deliveredTo,
        providerId: r.status === "sent" ? r.providerId : null,
        error: r.status === "failed" ? r.error : null,
        sentAt: r.status === "sent" ? new Date() : null,
      })
      .where(eq(t.outbox.id, m.id))
      .run();
    out[r.status]++;
  }
  return out;
}

export async function retryFailed(db: DB) {
  const ids = db.select({ id: t.outbox.id }).from(t.outbox).where(eq(t.outbox.status, "failed")).all().map((r) => r.id);
  return deliverQueued(db, ids);
}

"use server";

import { and, eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, t } from "@/lib/db";
import { REMEDIES, SEVERITIES } from "@/lib/db/schema";
import { aiEnabled, describeAiError, draftFromNotice } from "@/lib/ai";
import { searchRecalls } from "@/lib/cpsc";
import { importTransactions } from "@/lib/importer";
import { catalogItems } from "@/lib/products";
import { matchNotice } from "@/lib/recalls/matcher";
import { describePayPalError } from "@/lib/paypal/orders";
import { MAX_HISTORY_DAYS, searchAllTransactions } from "@/lib/paypal/transactions";
import { markShipped, resolveCase } from "@/lib/recalls/execute";
import { notifyBuyers, retryFailed, sendCaseUpdate } from "@/lib/recalls/notify";
import { caseByToken } from "@/lib/recalls/queries";
import { createRecall, matchRecall } from "@/lib/recalls/service";
import { syncRecall } from "@/lib/recalls/sync";

// NOTE: seller actions are unauthenticated for the hackathon demo. Add auth before real use.

const recallId = z.string().regex(/^RC-[A-F0-9]{6}$/);
const caseId = z.number().int().positive();
const remedy = z.enum(REMEDIES);

const optDate = z
  .string()
  .optional()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !Number.isNaN(d.getTime()), "Invalid date");

const RecallForm = z
  .object({
    title: z.string().trim().min(3, "Give the recall a title").max(140),
    hazard: z.string().trim().min(3, "Describe the hazard").max(1000),
    severity: z.enum(SEVERITIES),
    instructions: z.string().trim().max(1000).optional().default(""),
    skus: z.array(z.string().max(64)).min(1, "Pick at least one SKU"),
    remedies: z.array(remedy).min(1, "Offer at least one remedy"),
    replacementStock: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === "" ? null : Number(v)))
      .refine((n) => n === null || (Number.isInteger(n) && n >= 0), "Stock must be a whole number"),
    soldFrom: optDate,
    soldTo: optDate,
    sourceUrl: z.union([z.literal(""), z.url()]).optional().transform((v) => v || null),
  })
  .refine((r) => !r.soldFrom || !r.soldTo || r.soldFrom <= r.soldTo, { message: "'Sold from' must be before 'sold to'", path: ["soldTo"] });

export type FormState = { error?: string; values?: Record<string, unknown> } | undefined;

export async function createRecallAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = {
    title: form.get("title"),
    hazard: form.get("hazard"),
    severity: form.get("severity"),
    instructions: form.get("instructions") ?? "",
    skus: form.getAll("skus"),
    remedies: form.getAll("remedies"),
    replacementStock: form.get("replacementStock") ?? "",
    soldFrom: form.get("soldFrom") || undefined,
    soldTo: form.get("soldTo") ? `${form.get("soldTo")}T23:59:59.999` : undefined,
    sourceUrl: form.get("sourceUrl") ?? "",
  };
  const parsed = RecallForm.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, values: raw };
  const { id } = createRecall(getDb(), parsed.data);
  redirect(`/recalls/${id}`);
}

async function baseUrl() {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function notifyAction(id: string) {
  const r = await notifyBuyers(getDb(), recallId.parse(id), await baseUrl());
  refresh();
  return r;
}

export async function rescanAction(id: string) {
  const r = matchRecall(getDb(), recallId.parse(id));
  refresh();
  return r;
}

export async function resolveCaseAction(id: number, choice: string) {
  const db = getDb();
  const r = await resolveCase(db, caseId.parse(id), remedy.parse(choice), "seller");
  if (r.ok) await sendCaseUpdate(db, id);
  refresh();
  return r;
}

// Bulk: execute every outstanding case whose recommended remedy is a refund.
export async function applyRecommendedRefundsAction(id: string) {
  const db = getDb();
  const pending = db
    .select({ id: t.recallCases.id })
    .from(t.recallCases)
    .where(
      and(
        eq(t.recallCases.recallId, recallId.parse(id)),
        eq(t.recallCases.recommendedRemedy, "refund"),
        inArray(t.recallCases.status, ["identified", "notified"]),
      ),
    )
    .all();
  let ok = 0;
  const errors: string[] = [];
  for (const c of pending) {
    const r = await resolveCase(db, c.id, "refund", "seller");
    if (r.ok) {
      ok++;
      await sendCaseUpdate(db, c.id);
    }
    else errors.push(`#${c.id}: ${r.error}`);
  }
  refresh();
  return { ok, failed: errors.length, errors };
}

export async function markShippedAction(id: number, tracking: string) {
  try {
    markShipped(getDb(), caseId.parse(id), z.string().trim().max(64).parse(tracking) || undefined);
    await sendCaseUpdate(getDb(), id);
    refresh();
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

// Buyer-facing: the token in the emailed link is the only credential.
export async function buyerChooseAction(token: string, choice: string) {
  const db = getDb();
  const row = caseByToken(db, z.string().min(20).max(64).parse(token));
  if (!row) return { ok: false as const, error: "This link is invalid or has expired." };
  const r = await resolveCase(db, row.c.id, remedy.parse(choice), "buyer");
  if (r.ok) await sendCaseUpdate(db, row.c.id);
  refresh();
  // Buyers get a plain message; the seller sees PayPal's details on the recall page.
  if (!r.ok && /PayPal/.test(r.error)) {
    return { ok: false as const, error: "We couldn't complete that just now. The seller has been alerted. You can try again or choose another option." };
  }
  return r;
}

export async function importFromPayPalAction(days: number) {
  const n = z.number().int().min(1).max(MAX_HISTORY_DAYS).parse(days);
  try {
    const to = new Date();
    const { transactions, lastRefreshed } = await searchAllTransactions(new Date(to.getTime() - n * 864e5), to);
    const db = getDb();
    const summary = importTransactions(db, transactions, lastRefreshed);
    // New sales may belong to recalls that are already open.
    let newCases = 0;
    for (const r of db.select({ id: t.recalls.id }).from(t.recalls).where(eq(t.recalls.status, "active")).all()) {
      newCases += matchRecall(db, r.id).newCases;
    }
    refresh();
    return { ok: true as const, ...summary, newCases };
  } catch (err) {
    return { ok: false as const, error: describePayPalError(err) };
  }
}

export async function syncRecallAction(id: string) {
  const r = await syncRecall(getDb(), recallId.parse(id));
  refresh();
  return r;
}

export async function retryOutboxAction() {
  const r = await retryFailed(getDb());
  refresh();
  return r;
}

export async function searchCpscAction(q: string) {
  const query = z.string().trim().min(2).max(80).parse(q);
  try {
    const notices = await searchRecalls(query);
    const catalog = catalogItems();
    return { ok: true as const, results: notices.map((notice) => ({ notice, matches: matchNotice(notice, catalog) })) };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function aiDraftAction(text: string) {
  if (!aiEnabled()) return { ok: false as const, error: "Set ANTHROPIC_API_KEY in .env.local to enable AI drafting." };
  const notice = z.string().trim().min(40, "Paste the full notice text").max(50_000).safeParse(text);
  if (!notice.success) return { ok: false as const, error: notice.error.issues[0].message };
  try {
    return { ok: true as const, draft: await draftFromNotice(notice.data, catalogItems()) };
  } catch (err) {
    return { ok: false as const, error: describeAiError(err) };
  }
}

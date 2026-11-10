import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Money is stored as integer cents. Timestamps are integer ms.

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`);

export const products = sqliteTable("products", {
  sku: text("sku").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Manufacturer identity: what official recall notices refer to.
  brand: text("brand"),
  model: text("model"),
  upc: text("upc"),
  unitPriceCents: integer("unit_price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  createdAt: createdAt(),
});

export type ShipAddress = {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  countryCode?: string;
};

// One row per PayPal capture (a completed payment). This is the "where did every unit go" ledger.
export const sales = sqliteTable(
  "sales",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["checkout", "seed", "paypal_import", "legacy"] }).notNull(),
    paypalOrderId: text("paypal_order_id"),
    // PayPal capture ID == the transaction ID in Transaction Search. Unique, so imports dedupe.
    captureId: text("capture_id").unique(),
    buyerName: text("buyer_name"),
    buyerEmail: text("buyer_email"),
    shipAddress: text("ship_address", { mode: "json" }).$type<ShipAddress>(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    capturedAt: integer("captured_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sales_captured_at_idx").on(t.capturedAt)],
);

export const saleItems = sqliteTable(
  "sale_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    quantity: integer("quantity").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
  },
  (t) => [index("sale_items_sku_idx").on(t.sku)],
);

export const REMEDIES = ["refund", "replace", "repair"] as const;
export type Remedy = (typeof REMEDIES)[number];
export const SEVERITIES = ["high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const recalls = sqliteTable("recalls", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  hazard: text("hazard").notNull(),
  severity: text("severity", { enum: SEVERITIES }).notNull(),
  // What the buyer should do right now, e.g. "Stop using and unplug immediately."
  instructions: text("instructions").notNull().default(""),
  remedies: text("remedies", { mode: "json" }).$type<Remedy[]>().notNull(),
  replacementStock: integer("replacement_stock"),
  soldFrom: integer("sold_from", { mode: "timestamp_ms" }),
  soldTo: integer("sold_to", { mode: "timestamp_ms" }),
  sourceUrl: text("source_url"),
  status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
  createdAt: createdAt(),
});

export const recallSkus = sqliteTable(
  "recall_skus",
  {
    recallId: text("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
  },
  (t) => [primaryKey({ columns: [t.recallId, t.sku] })],
);

export const CASE_STATUSES = ["identified", "notified", "remedy_selected", "processing", "resolved", "failed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type RefundRail = "paypal_refund" | "payout" | "none";

export type Resolution = {
  remedy: Remedy;
  rail?: RefundRail;
  paypalRefundId?: string;
  paypalPayoutBatchId?: string;
  paypalStatus?: string;
  amountCents?: number;
  shipTo?: ShipAddress;
  note?: string;
  error?: string;
};

// One affected sale line per recall: the unit(s) that must come back, be fixed, or be paid for.
export const recallCases = sqliteTable(
  "recall_cases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recallId: text("recall_id")
      .notNull()
      .references(() => recalls.id, { onDelete: "cascade" }),
    saleId: text("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    saleItemId: integer("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    quantity: integer("quantity").notNull(),
    // Only the recalled line is refunded, not the whole cart.
    refundAmountCents: integer("refund_amount_cents").notNull(),
    recommendedRemedy: text("recommended_remedy", { enum: REMEDIES }).notNull(),
    refundRail: text("refund_rail", { enum: ["paypal_refund", "payout", "none"] }).notNull(),
    recommendationReason: text("recommendation_reason").notNull(),
    chosenRemedy: text("chosen_remedy", { enum: REMEDIES }),
    status: text("status", { enum: CASE_STATUSES }).notNull().default("identified"),
    buyerToken: text("buyer_token").notNull().unique(),
    resolution: text("resolution", { mode: "json" }).$type<Resolution>(),
    notifiedAt: integer("notified_at", { mode: "timestamp_ms" }),
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("recall_cases_recall_item_uq").on(t.recallId, t.saleItemId)],
);

// Audit trail per case. Regulators ask "what did you do, and when?"
export const caseEvents = sqliteTable("case_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("case_id")
    .notNull()
    .references(() => recallCases.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  detail: text("detail").notNull().default(""),
  at: createdAt(),
});

// Buyer emails: recall notices and status updates. Delivered over SMTP when configured, otherwise just logged.
export const outbox = sqliteTable("outbox", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  caseId: integer("case_id").references(() => recallCases.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["notice", "update"] }).notNull().default("notice"),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  html: text("html"),
  status: text("status", { enum: ["queued", "logged", "sent", "failed"] }).notNull(),
  deliveredTo: text("delivered_to"), // differs from `to` when EMAIL_REDIRECT_TO is set
  providerId: text("provider_id"),
  error: text("error"),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

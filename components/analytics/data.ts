// AG Studio data sources for Recall Desk: one table per row type in lib/analytics.ts, the joins
// between them, a shared calendar, and the recall measures (exposure, refunded, in flight).
// The descriptions matter: Studio's agents read them to decide which fields answer a question.

import type {
  AgDataSourcesDefinition,
  AgExpressionFieldDefinition,
  AgFieldDefinition,
  AgFormat,
  AgRelationDefinition,
} from "ag-studio";
import type { AnalyticsData } from "@/lib/analytics";

const CALENDAR_ID = "calendar";

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];
const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({
    id,
    name,
    format,
    ...(format === "currencyFormat" && { formatOptions: { format: USD } }),
    ...(hide && { hide }),
  }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split(".");
  const [targetTable, targetField] = target.split(".");
  return {
    id,
    source: { tableId: sourceTable, fieldId: sourceField },
    target: { tableId: targetTable, fieldId: targetField },
    type: "many-to-one",
  };
};

const onCalendar = (tableId: string, fieldId: string): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
});

const sumOf = (id: string) => ({ id, aggregation: "sum" as const });
const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: "percentageFormat",
  isMeasure: true,
  expression: { operator: "divide", inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const hasData = (data: AnalyticsData) => data.sales.length > 0;

export function buildStudioData(data: AnalyticsData): AgDataSourcesDefinition {
  const dates = data.sales.map((s) => s.soldAt).filter((d): d is string => !!d).sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      "Recall Desk: a small online seller's PayPal sales and its product recall response. " +
      "Sales are PayPal captures (refundable through PayPal for 180 days) plus imported order history with no capture (refunded by PayPal payout). " +
      "A recall covers one or more SKUs; every affected sale line becomes a case with a remedy (refund, replace or repair) and a status. " +
      "All money is USD.",
    sources: [
      {
        id: "products",
        description: "The catalog. Brand and model are what official recall notices (CPSC) refer to.",
        data: data.products,
        fields: fields([
          ["sku", "SKU", "textFormat"],
          ["name", "Product", "textFormat"],
          ["brand", "Brand", "textFormat"],
          ["model", "Model", "textFormat"],
          ["unitPrice", "List Price", "currencyFormat"],
        ]),
      },
      {
        id: "sales",
        description:
          "One row per order. Channel is 'PayPal capture' or 'Imported history'. Refund route is how a refund would be paid today: " +
          "'PayPal refund' for captures under 180 days old, otherwise 'PayPal payout'.",
        data: data.sales,
        fields: fields([
          ["id", "Order ID", "textFormat", true],
          ["channel", "Channel", "textFormat"],
          ["buyer", "Buyer", "textFormat"],
          ["city", "City", "textFormat"],
          ["state", "State", "textFormat"],
          ["total", "Order Total", "currencyFormat"],
          ["soldAt", "Sold On", "dateFormat"],
          ["ageDays", "Order Age (days)", "integerFormat"],
          ["refundRoute", "Refund Route", "textFormat"],
        ]),
      },
      {
        id: "saleItems",
        name: "Order Lines",
        description: "One row per SKU on an order. Units and revenue by SKU come from here.",
        data: data.saleItems,
        fields: fields([
          ["id", "Line ID", "textFormat", true],
          ["saleId", "Order ID", "textFormat", true],
          ["sku", "Line SKU", "textFormat", true],
          ["quantity", "Units Sold", "integerFormat"],
          ["unitPrice", "Unit Price", "currencyFormat"],
          ["lineTotal", "Line Revenue", "currencyFormat"],
        ]),
      },
      {
        id: "recalls",
        description: "Recalls the seller has opened. Severity is high, medium or low.",
        data: data.recalls,
        fields: fields([
          ["id", "Recall ID", "textFormat", true],
          ["title", "Recall", "textFormat"],
          ["severity", "Severity", "textFormat"],
          ["status", "Recall Status", "textFormat"],
          ["openedAt", "Opened On", "dateFormat"],
        ]),
      },
      {
        id: "cases",
        name: "Recall Cases",
        description:
          "One row per affected order line in a recall. Exposure is the most the seller could owe (the line's price). " +
          "Refunded is money that reached the buyer; In flight is money PayPal has accepted but not yet confirmed. " +
          "Status, in pipeline order: Resolved, Money in flight, Awaiting shipment, Notified no reply yet, Not yet notified, Failed.",
        data: data.cases,
        fields: fields([
          ["id", "Case ID", "textFormat", true],
          ["recallId", "Case Recall ID", "textFormat", true],
          ["saleId", "Case Order ID", "textFormat", true],
          ["sku", "Case SKU", "textFormat", true],
          ["buyerState", "Buyer State", "textFormat"],
          ["units", "Affected Units", "integerFormat"],
          ["exposure", "Exposure", "currencyFormat"],
          ["remedy", "Remedy", "textFormat"],
          ["recommendedRemedy", "Recommended Remedy", "textFormat"],
          ["rail", "Money Rail", "textFormat"],
          ["status", "Case Status", "textFormat"],
          ["statusRank", "Status Rank", "integerFormat", true],
          ["refunded", "Refunded", "currencyFormat"],
          ["inFlight", "In Flight", "currencyFormat"],
          ["isResolved", "Is Resolved", "booleanFormat"],
          ["notifiedAt", "Notified On", "dateFormat"],
          ["resolvedAt", "Resolved On", "dateFormat"],
          ["daysToResolve", "Days to Resolve", "integerFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("line-sale", "saleItems.saleId", "sales.id"),
      manyToOne("line-product", "saleItems.sku", "products.sku"),
      manyToOne("case-recall", "cases.recallId", "recalls.id"),
      manyToOne("case-sale", "cases.saleId", "sales.id"),
      manyToOne("case-product", "cases.sku", "products.sku"),
      onCalendar("sales", "soldAt"),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: "Calendar",
        range: {
          from: { type: "date", value: dates[0] ?? today },
          to: { type: "date", value: today },
        },
        fragments: ["year", "quarter", "month", "week", "day"],
      },
    ],
    expressions: [
      ratio("resolvedShare", "Resolved Share", "Refunded money as a share of total exposure.", "cases.refunded", "cases.exposure"),
    ],
  };
}

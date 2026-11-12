// The built-in Recall Desk report, as AG Studio report state. Field ids ('cases.exposure') refer to
// the data sources in ./data.ts. Users (and the agents) can change it; Reset brings this back.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";

// Canvas position in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const kpi = (text: string, value: { id: string; aggregation?: "sum" | "countd" }) => ({
  type: "value" as const,
  dataMapping: { value: [value] },
  format: {
    title: { enabled: true, text },
    style: { typography: { fontSize: 26, fontWeight: "bold" as const } },
  },
});

export const PROGRESS_WIDGET = "recall-progress";

const response: AgPageState = {
  id: "response",
  widgets: {
    recall: {
      type: "list-filter",
      dataMapping: { value: [{ id: "recalls.title" }] },
      format: title("Recall"),
    },
    "kpi-lines": kpi("Affected order lines", countd("cases.id")),
    "kpi-exposure": kpi("Exposure", sum("cases.exposure")),
    "kpi-refunded": kpi("Refunded", sum("cases.refunded")),
    "kpi-flight": kpi("Money in flight", sum("cases.inFlight")),
    progress: {
      type: PROGRESS_WIDGET,
      dataMapping: { status: [{ id: "cases.status" }], value: [countd("cases.id")] },
      format: title("Where every affected buyer stands"),
      // A custom widget type (registered in RecallStudio), so outside Studio's built-in typings.
    } as never,
    "remedy-mix": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "cases.remedy" }], valueKey: [countd("cases.id")] },
      // Sorted by remedy, not by size, so each remedy keeps its colour across charts.
      sort: [{ field: { id: "cases.remedy" }, direction: "asc" }],
      format: title("Remedy mix"),
    },
    "buyers-by-state": {
      type: "bar-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "sales.state" }],
        valueKey: [countd("cases.id")],
        legendKey: [{ id: "cases.remedy" }],
      },
      sort: [{ field: countd("cases.id"), direction: "desc" }],
      format: {
        ...title("Affected buyers by state and remedy"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    cases: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "sales.buyer" },
          { id: "sales.state" },
          { id: "products.name" },
          { id: "cases.remedy" },
          { id: "cases.rail" },
          { id: "cases.status" },
          sum("cases.exposure"),
          sum("cases.refunded"),
        ],
      },
      sort: [{ field: sum("cases.exposure"), direction: "desc" }],
      format: title("Affected buyers"),
    },
  },
  widgetLayout: {
    "kpi-lines": at(0, 0, 5, 7),
    "kpi-exposure": at(5, 0, 5, 7),
    "kpi-refunded": at(10, 0, 5, 7),
    "kpi-flight": at(15, 0, 5, 7),
    recall: at(20, 0, 4, 7),
    progress: at(0, 7, 24, 10),
    "remedy-mix": at(0, 17, 8, 18),
    "buyers-by-state": at(8, 17, 16, 18),
    cases: at(0, 35, 24, 20),
  },
};

const exposure: AgPageState = {
  id: "exposure",
  widgets: {
    "sold-on": {
      type: "date-filter",
      dataMapping: { value: [{ id: "sales.soldAt" }] },
      format: { style: { filterType: "relative" } },
    },
    "kpi-revenue": kpi("Revenue", sum("saleItems.lineTotal")),
    "kpi-units": kpi("Units sold", sum("saleItems.quantity")),
    "kpi-orders": kpi("Orders", countd("sales.id")),
    "units-by-month": {
      type: "column-chart-stacked",
      dataMapping: {
        categoryKey: [{ id: "calendar::month" }],
        valueKey: [sum("saleItems.quantity")],
        legendKey: [{ id: "products.name" }],
      },
      format: {
        ...title("Units sold by month: what's in customers' homes"),
        style: { theme: { common: { legend: { enabled: true } } } },
      },
    },
    "refund-route": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "sales.refundRoute" }], valueKey: [sum("saleItems.lineTotal")] },
      format: title("How a refund would be paid today"),
    },
    "units-by-state": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "sales.state" }], valueKey: [sum("saleItems.quantity")] },
      sort: [{ field: sum("saleItems.quantity"), direction: "desc" }],
      format: title("Units by buyer state"),
    },
    "sku-pivot": {
      type: "pivot-grid",
      dataMapping: {
        rows: [{ id: "products.brand" }, { id: "products.name" }],
        columns: [{ id: "sales.refundRoute" }],
        values: [sum("saleItems.quantity")],
      },
      format: {
        ...title("Units by product and refund route"),
        style: { totalColumns: true, totalColumnsPlacement: "before", grandTotalRow: { enabled: true } },
      },
    },
  },
  widgetLayout: {
    "kpi-revenue": at(0, 0, 6, 6),
    "kpi-units": at(6, 0, 6, 6),
    "kpi-orders": at(12, 0, 6, 6),
    "sold-on": at(18, 0, 6, 6),
    "units-by-month": at(0, 6, 16, 18),
    "refund-route": at(16, 6, 8, 18),
    "units-by-state": at(0, 24, 10, 22),
    "sku-pivot": at(10, 24, 14, 22),
  },
};

export const PAGES = [
  { id: response.id, label: "Recall response" },
  { id: exposure.id, label: "Sales exposure" },
];

export const defaultReport: AgReportState = {
  selectedPageId: response.id,
  pages: [response, exposure],
  // The dashboard's own filter widgets do the filtering; the side panel starts closed.
  panels: { filters: { collapsed: true } },
};

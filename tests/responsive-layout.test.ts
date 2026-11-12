import { describe, expect, it } from "vitest";
import type { AgResponsiveLayoutCandidate, AgWidgetLayoutState } from "ag-studio";
import { defaultReport, stackLayout } from "@/components/analytics/report";

const cand = (xTrack: number, yTrack: number, xSpan: number, ySpan: number, min = { xSpan: 1, ySpan: 1 }): AgResponsiveLayoutCandidate => ({
  layout: { xTrack, yTrack, xSpan, ySpan },
  minSize: min,
});
const state = { columns: 24, rows: undefined };

const overlaps = (a: AgWidgetLayoutState, b: AgWidgetLayoutState) =>
  a.xTrack < b.xTrack + b.xSpan && b.xTrack < a.xTrack + a.xSpan && a.yTrack < b.yTrack + b.ySpan && b.yTrack < a.yTrack + a.ySpan;

describe("stackLayout (phone breakpoint)", () => {
  it("pairs tiles two to a row and gives wide widgets the full width, in reading order", () => {
    const [kpiA, kpiB, kpiC, wide] = [cand(0, 0, 5, 7), cand(5, 0, 5, 7), cand(10, 0, 5, 7), cand(0, 7, 24, 10)];
    // Handed over out of order: results line up with the input, positions follow the authored reading order.
    const out = stackLayout([wide, kpiB, kpiA, kpiC], state);
    expect(out[2]).toEqual({ xTrack: 0, yTrack: 0, xSpan: 12, ySpan: 7 });
    expect(out[1]).toEqual({ xTrack: 12, yTrack: 0, xSpan: 12, ySpan: 7 });
    expect(out[3]).toEqual({ xTrack: 0, yTrack: 7, xSpan: 12, ySpan: 7 });
    expect(out[0]).toEqual({ xTrack: 0, yTrack: 14, xSpan: 24, ySpan: 10 });
  });

  it("never goes below a widget's minimum size", () => {
    const out = stackLayout([cand(0, 0, 4, 3, { xSpan: 16, ySpan: 8 })], state);
    expect(out[0]).toEqual({ xTrack: 0, yTrack: 0, xSpan: 16, ySpan: 8 });
  });

  it("keeps the default report's pages inside the grid with nothing overlapping", () => {
    for (const page of defaultReport.pages) {
      const layouts = Object.values(page.widgetLayout ?? {}) as AgWidgetLayoutState[];
      const out = stackLayout(layouts.map((layout) => ({ layout, minSize: { xSpan: 1, ySpan: 1 } })), state);
      expect(out).toHaveLength(layouts.length);
      for (const [i, a] of out.entries()) {
        expect(a.xTrack).toBeGreaterThanOrEqual(0);
        expect(a.xTrack + a.xSpan).toBeLessThanOrEqual(state.columns);
        for (const b of out.slice(i + 1)) expect(overlaps(a, b), `${page.id}: widgets ${i} overlap`).toBe(false);
      }
    }
  });
});

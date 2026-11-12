"use client";

// Custom AG Studio widget: the recall pipeline as one segmented bar, in the same status colours and
// order as the rest of Recall Desk. Map any status field and any measure (cases, exposure,
// refunded); page filters and cross-filters apply as they do to built-in widgets.

import { useEffect, useState } from "react";
import type { AgWidgetField, AgWidgetParams } from "ag-studio";
import { AgNoDataOverlay } from "ag-studio-react";

const STATUS_STYLE: Record<string, { fill: string; ink: string }> = {
  Resolved: { fill: "var(--st-resolved)", ink: "#fff" },
  "Money in flight": { fill: "var(--st-flight)", ink: "#fff" },
  "Awaiting shipment": { fill: "var(--st-ship)", ink: "#18181b" },
  "Notified, no reply yet": { fill: "var(--st-notified)", ink: "#18181b" },
  "Not yet notified": { fill: "var(--st-identified)", ink: "#18181b" },
  Failed: { fill: "var(--st-failed)", ink: "#fff" },
};
const ORDER = Object.keys(STATUS_STYLE);
const OTHER = { fill: "var(--muted)", ink: "#fff" };

type Part = { label: string; value: number };
type Mapping = { status?: AgWidgetField[]; value?: AgWidgetField[] };

export default function RecallProgressWidget(params: AgWidgetParams) {
  const { widgetApi } = params;
  const mapping = params.dataMapping as Mapping;
  const status = mapping.status?.[0];
  const value = mapping.value?.[0];
  const [parts, setParts] = useState<Part[] | null>(null);

  useEffect(() => {
    if (!status || !value) return;
    let live = true;
    const apply = (rows: Record<string, unknown>[]) => {
      if (!live) return;
      const next = rows
        .map((r) => ({ label: String(r[status.key] ?? "Unknown"), value: Number(r[value.key] ?? 0) }))
        .filter((p) => p.value > 0)
        .sort((a, b) => rank(a.label) - rank(b.label));
      setParts(next);
      widgetApi.setDisplayState(next.length ? "displayed" : "noData");
    };
    widgetApi.setDisplayState("loading");
    widgetApi
      .getData({ fields: [status, value] }, { queryId: "progress", onDataUpdated: (r) => apply(r.results.rows) })
      .then((r) => !r.replaced && apply(r.results.rows));
    return () => {
      live = false;
    };
  }, [widgetApi, status, value]);

  if (!parts) return null;
  if (parts.length === 0) return <AgNoDataOverlay />;

  const total = parts.reduce((s, p) => s + p.value, 0);
  const done = parts.find((p) => p.label === "Resolved")?.value ?? 0;
  const fmt = (n: number) => (value ? widgetApi.formatFieldValue(value, n) : String(n));
  const pct = (n: number) => Math.round((n / total) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%", justifyContent: "center", padding: "4px 2px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 28, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pct(done)}%</span>
        <span style={{ fontSize: 13, color: "var(--muted)" }}>
          resolved · {fmt(done)} of {fmt(total)}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Recall progress: ${parts.map((p) => `${p.label} ${fmt(p.value)}`).join(", ")}`}
        style={{ display: "flex", gap: 2, height: 28 }}
      >
        {parts.map((p) => {
          const s = STATUS_STYLE[p.label] ?? OTHER;
          return (
            <div
              key={p.label}
              title={`${p.label}: ${fmt(p.value)} (${pct(p.value)}%)`}
              style={{ flexGrow: p.value, flexBasis: 0, minWidth: 6, background: s.fill, borderRadius: 4, position: "relative" }}
            >
              {pct(p.value) >= 10 && (
                <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 12, fontWeight: 600, color: s.ink, fontVariantNumeric: "tabular-nums" }}>
                  {fmt(p.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <ul style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", margin: 0, padding: 0, listStyle: "none", fontSize: 12, color: "var(--muted)" }}>
        {parts.map((p) => (
          <li key={p.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: (STATUS_STYLE[p.label] ?? OTHER).fill }} />
            {p.label} <span style={{ color: "var(--foreground)", fontVariantNumeric: "tabular-nums" }}>{fmt(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function rank(label: string) {
  const i = ORDER.indexOf(label);
  return i === -1 ? ORDER.length : i;
}

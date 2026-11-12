"use client";

// The analytics workspace: one AG Studio instance over Recall Desk's data, with our theme, the
// custom recall-progress widget, and (when configured) the agent team from ./ai.ts. Studio leaves
// page navigation, saving and mode to the host, so this file owns those; the report lives in
// localStorage per browser.

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AgStudioAiModule,
  enableStudioDevValidations,
  type AgCoreDefaultRegistry,
  type AgReportState,
  type AgStudioApi,
  type AgStudioMode,
  type AgWidgetsConfig,
} from "ag-studio";
import { AgStudio, AgStudioProvider, createWidgets } from "ag-studio-react";
import { Pencil, RotateCcw, Save, Sparkles } from "lucide-react";
import type { AnalyticsData } from "@/lib/analytics";
import { buildAi } from "./ai";
import { buildStudioData } from "./data";
import RecallProgressWidget from "./RecallProgressWidget";
import { PAGES, PROGRESS_WIDGET, defaultReport } from "./report";
import { recallStudioTheme } from "./theme";

if (process.env.NODE_ENV !== "production") enableStudioDevValidations();

const STORAGE_KEY = "recall-desk.analytics.report.v1";
const NAMES_KEY = "recall-desk.analytics.page-names.v1";

const progressWidget = {
  id: PROGRESS_WIDGET,
  label: "Recall progress",
  icon: {
    url: "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="9" width="8" height="6" rx="1"/><rect x="11" y="9" width="6" height="6" rx="1"/><rect x="18" y="9" width="4" height="6" rx="1"/></svg>',
      ),
  },
  dataMapping: {
    status: {
      type: "field",
      supportedRoles: ["category"],
      requires: { cardinality: "many" },
      required: true,
      aiDescription: "The case status field (cases.status). Each status becomes a segment, coloured and ordered like the rest of Recall Desk.",
    },
    value: {
      type: "field",
      supportedRoles: ["numeric"],
      requires: { per: "dataMapping.status", cardinality: "one" },
      required: true,
      aiDescription: "The measure per status: a count of cases (countd cases.id), or money such as sum of cases.exposure or cases.refunded.",
    },
  },
  form: (params: { createDefaults: (o: { dataMappingItems: { key: string; label: string }[] }) => unknown }) =>
    params.createDefaults({
      dataMappingItems: [
        { key: "status", label: "Status" },
        { key: "value", label: "Measure" },
      ],
    }),
  comp: RecallProgressWidget,
  defaultSize: { width: 800, height: 180 },
  minSize: { width: 320, height: 140 },
  ai: {
    description:
      "Recall progress: a single segmented bar showing how a recall's affected buyers (or its money) split across case statuses, " +
      "with the resolved share as a headline. Use it for 'how far along is the recall' questions.",
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const widgets = (base: AgWidgetsConfig<AgCoreDefaultRegistry>): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createWidgets<any>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    additionalTypes: [progressWidget as any],
    menu: [...(base.menu ?? []), { label: "Recall", widgetIds: [PROGRESS_WIDGET] } as never],
  });

function loadNames(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function loadSaved(): AgReportState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AgReportState) : null;
  } catch {
    return null;
  }
}

const noSubscription = () => () => {};

type Props = { data: AnalyticsData; licenseKey?: string; aiEnabled: boolean };

export default function RecallStudio(props: Props) {
  // Saved reports live in localStorage, so Studio renders in the browser only.
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  return inBrowser ? <Workspace {...props} /> : <div className="h-full rounded-lg bg-surface motion-safe:animate-pulse" />;
}

function Workspace({ data, licenseKey, aiEnabled }: Props) {
  const apiRef = useRef<AgStudioApi | null>(null);
  const [initialState] = useState<AgReportState>(() => loadSaved() ?? defaultReport);
  const [pageId, setPageId] = useState(initialState.selectedPageId);
  const [pageIds, setPageIds] = useState(() => initialState.pages.map((p) => p.id));
  // Tab titles for pages the analyst creates (Studio pages have no names of their own).
  const [names, setNames] = useState<Record<string, string>>(loadNames);
  const [mode, setMode] = useState<AgStudioMode>("view");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const studioData = useMemo(() => buildStudioData(data), [data]);
  const ai = useMemo(
    () => (aiEnabled ? buildAi((id, title) => setNames((n) => ({ ...n, [id]: title }))) : undefined),
    [aiEnabled],
  );

  const showPage = (id: string) => {
    const api = apiRef.current;
    if (!api) return;
    api.setState({ ...api.getState(), selectedPageId: id });
    setPageId(id);
  };
  // Studio shows its AI panel in edit mode only: switch to edit with the chat open.
  const askAnalyst = () => {
    const api = apiRef.current;
    if (api) {
      const st = api.getState();
      api.setState({ ...st, panels: { ...st.panels, ai: { ...st.panels?.ai, collapsed: false } } });
    }
    setMode("edit");
  };
  const save = () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(api.getState()));
      localStorage.setItem(NAMES_KEY, JSON.stringify(names));
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch {
      setSavedAt(null);
    }
  };
  const reset = () => {
    const api = apiRef.current;
    if (!api) return;
    if (!confirm("Reset to the default report? Pages and changes you saved in this browser will be removed.")) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(NAMES_KEY);
    } catch {}
    api.setState(defaultReport);
    api.clearHistory();
    setPageId(defaultReport.selectedPageId);
    setPageIds(defaultReport.pages.map((p) => p.id));
    setNames({});
    setSavedAt(null);
  };

  // Pages come from Studio's state, so pages the agents add get a tab too.
  const pages = pageIds.map((id, i) => ({ id, label: names[id] ?? PAGES.find((p) => p.id === id)?.label ?? `Page ${i + 1}` }));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2">
        <nav className="flex gap-1 text-sm" aria-label="Report pages">
          {pages.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => showPage(p.id)}
              aria-current={p.id === pageId ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 transition-colors duration-150 ${p.id === pageId ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}
            >
              {p.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          {ai && (
            <button
              type="button"
              onClick={askAnalyst}
              className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 transition-colors duration-150 hover:bg-background"
            >
              <Sparkles size={14} aria-hidden className="text-accent" /> Ask the analyst
            </button>
          )}
          <span aria-live="polite" className="text-xs text-muted">{savedAt && `Saved ${savedAt}`}</span>
          <button
            type="button"
            onClick={() => setMode(mode === "edit" ? "view" : "edit")}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 transition-colors duration-150 hover:bg-background"
            aria-pressed={mode === "edit"}
          >
            <Pencil size={14} aria-hidden /> {mode === "edit" ? "Done editing" : "Edit"}
          </button>
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 font-medium text-on-accent transition-opacity duration-150 hover:opacity-90"
          >
            <Save size={14} aria-hidden /> Save
          </button>
          <button
            type="button"
            onClick={reset}
            title="Back to the default report"
            aria-label="Reset to the default report"
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
          >
            <RotateCcw size={15} aria-hidden />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <AgStudioProvider licenseKey={licenseKey} modules={ai ? [AgStudioAiModule] : undefined}>
          <AgStudio
            style={{ height: "100%", width: "100%" }}
            theme={recallStudioTheme}
            data={studioData}
            widgets={widgets}
            ai={ai}
            initialState={initialState}
            mode={mode}
            onApiReady={(e) => {
              apiRef.current = e.api;
            }}
            onStateUpdated={(e) => {
              setPageId(e.state.selectedPageId);
              const ids = e.state.pages.map((p) => p.id);
              setPageIds((prev) => (prev.join() === ids.join() ? prev : ids));
            }}
          />
        </AgStudioProvider>
      </div>
    </div>
  );
}

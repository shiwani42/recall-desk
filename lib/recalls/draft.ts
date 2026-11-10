// Turn a notice (CPSC or AI-read) into recall-form defaults. Pure: safe on client and server.
import type { NoticeDraft } from "@/lib/ai";
import type { Notice } from "@/lib/cpsc";
import type { Match } from "./matcher";

export type RecallInitial = {
  title: string;
  hazard: string;
  instructions: string;
  severity: string;
  skus: string[];
  remedies: string[];
  sourceUrl: string;
};
export type Suggestion = { confidence: "strong" | "possible"; reason: string };
export type Draft = { key: string; initial: RecallInitial; suggestions: Record<string, Suggestion>; note: string; source: string };

export function draftFromCpsc(notice: Notice, matches: Match[]): Draft {
  return {
    key: `cpsc-${notice.id}`,
    source: `CPSC recall #${notice.id} · ${notice.date}`,
    initial: {
      title: notice.title,
      hazard: notice.hazard,
      instructions: notice.instructions,
      severity: notice.severity,
      // Only strong matches are pre-selected; "possible" ones need the seller to confirm.
      skus: matches.filter((m) => m.confidence === "strong").map((m) => m.sku),
      remedies: notice.remedies,
      sourceUrl: notice.url,
    },
    suggestions: Object.fromEntries(matches.map((m) => [m.sku, { confidence: m.confidence, reason: m.reasons.join("; ") }])),
    note: [
      notice.units && `Units: ${notice.units}.`,
      notice.injuries,
      notice.soldAt && `Retail: ${notice.soldAt}`,
      "Sold-date window left blank on purpose: units you sold after the retail window can still be affected.",
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function draftFromAi(d: NoticeDraft): Draft {
  return {
    key: `ai-${Date.now()}`,
    source: "Drafted by AI from the pasted notice. Review before creating.",
    initial: {
      title: d.title,
      hazard: d.hazard,
      instructions: d.instructions,
      severity: d.severity,
      skus: d.matches.filter((m) => m.confidence === "strong").map((m) => m.sku),
      remedies: d.remedies.length ? d.remedies : ["refund"],
      sourceUrl: "",
    },
    suggestions: Object.fromEntries(d.matches.map((m) => [m.sku, { confidence: m.confidence, reason: m.reason }])),
    note: d.affected_window ? `Affected window per notice: ${d.affected_window}` : "",
  };
}

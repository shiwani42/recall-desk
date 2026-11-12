// The analytics page's agent team, on AG Studio's Agent Framework with Claude as the model.
//
//   Recall analyst (ours, primary)  knows recalls: PayPal's 180-day refund window, payouts vs refunds,
//                                   the remedy rules. Has two Recall Desk tools and reads the data,
//                                   then delegates dashboard changes to Studio's built-in team.
//   Studio's built-in agents         lead, data, page, planning, widget: they build and edit widgets.
//
// Every agent runs on the same Claude adapter (./claude-adapter.ts -> /api/ai/claude).

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgStudioApi } from "ag-studio";
import { ANALYST_MODELS } from "@/lib/claude-models";
import { claudeAdapter } from "./claude-adapter";

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: "What if we recall the heaters?",
    prompt: "What would it cost to recall every HTR-200 space heater sold in the last 6 months? Split it by how the money would move, and add widgets for it on a new page.",
  },
  {
    label: "Where is the rocket recall stuck?",
    prompt: "For the Stomp Rocket recall, which buyers still have money in flight or haven't replied, and what should I do next?",
  },
  {
    label: "Refresh PayPal status",
    prompt: "Check PayPal for the latest status of every refund and payout that's still in flight.",
  },
];

const ANALYST_INSTRUCTIONS = `You are the Recall analyst inside Recall Desk, a tool a small online seller uses to respond to product safety recalls on its PayPal sales.

What you know that the dashboard doesn't say:
- A PayPal capture can be refunded through PayPal only for 180 days. Older sales, and imported history with no capture, are refunded by PayPal Payout to the buyer's email instead.
- Remedy rules: high severity -> refund; unit price under $20 -> refund; replacement in stock -> replace; otherwise repair.
- Case statuses, in pipeline order: Resolved, Money in flight (PayPal accepted it; a payout stays here while UNCLAIMED, i.e. the buyer has no PayPal account on that email yet), Awaiting shipment, Notified no reply yet, Not yet notified, Failed.
- Money is USD.

How to work:
- For "what if we recalled X" questions call recall_exposure. It runs the real matching and remedy rules over the sales ledger and writes nothing. Quote its numbers and its reasons (byReason); never invent figures or reasons.
- For questions about the current data, read the schema and run queries yourself.
- To see whether a recalled product is still for sale at other retailers, or which safe alternatives a refunded buyer could buy instead, call market_check (live retailer data from Channel3).
- To refresh PayPal state for refunds and payouts in flight, call refresh_paypal_status, then tell the user to reload the page to see the new numbers.
- Studio's agents work on the selected page only and can't create pages. When the user wants a new page, call create_page first (it selects the new page), then delegate.
- A "what if we recalled X" page has no recall cases yet: build it from sales and order lines, filtered by products.sku and sales.soldAt
  (for example saleItems.lineTotal summed by sales.refundRoute, saleItems.quantity summed by sales.state), not from the cases table.
- To add, change or lay out widgets, delegate to Studio's lead agent with a precise brief: the page, each widget's type and title, and the exact field ids (for example cases.exposure summed, cases.status, sales.state). For a pipeline view, ask for the "recall-progress" widget with cases.status as Status and a measure.
- Be brief and concrete: lead with the number, then what to do next. Seller-facing language, no jargon.`;

export type PageCreated = (pageId: string, title: string) => void;

export function buildAi(onPageCreated: PageCreated): AgAiHarnessSetup {
  const adapter = claudeAdapter({ model: ANALYST_MODELS[0].id });

  return ({ api: coreApi }) => {
    // The setup receives the core API; the harness and tool builders take the full Studio API it is.
    const api = coreApi as unknown as AgStudioApi;
    return createAiHarness(api, ({ tools, builtIn }) => {
      const team = Object.values(builtIn).map((def) => directLlmRunner({ ...def, adapter }));
      const analyst = directLlmRunner({
        id: "recall-analyst",
        name: "Recall analyst",
        description: "Answers recall questions with Recall Desk's own rules and data, then hands dashboard changes to Studio's agents.",
        adapter,
        maxTurns: 16,
        instructions: () => `${ANALYST_INSTRUCTIONS}\n\nToday is ${new Date().toISOString().slice(0, 10)}.`,
        tools: () => [
          tools.studio.viewSchema(),
          tools.studio.viewReport(),
          tools.studio.executeQuery(),
          recallExposureTool(api),
          refreshPayPalTool(api),
          marketCheckTool(api),
          createPageTool(api, onPageCreated),
          tools.delegateTo(["lead"]),
          tools.renameThread(),
        ],
      });
      return {
        agents: [analyst, ...team],
        primary: analyst.id,
        promptStarters: PROMPT_STARTERS,
      };
    });
  };
}

function recallExposureTool(api: AgStudioApi) {
  return api.defineAiTool({
    name: "recall_exposure",
    description:
      "What a recall of these SKUs would involve, using Recall Desk's real matching window, remedy rules and PayPal refund-window logic. " +
      "Returns affected order lines, buyers, units, total exposure, cash that would go out, a split by remedy and by money rail (PayPal refund vs PayPal payout), and top buyer states. Writes nothing.",
    params: (s) =>
      s.object({
        skus: s.array(s.string(), { description: "Catalog SKUs, e.g. HTR-200" }),
        soldFrom: s.string({ description: "First sale date covered, YYYY-MM-DD" }).optional(),
        soldTo: s.string({ description: "Last sale date covered, YYYY-MM-DD" }).optional(),
        severity: s.enum(["high", "medium", "low"] as const, { description: "Hazard severity; defaults to high" }).optional(),
        remedies: s.array(s.enum(["refund", "replace", "repair"] as const), { description: "Remedies the recall offers; defaults to refund only" }).optional(),
        replacementStock: s.number({ description: "Replacement units in stock, if replace is offered" }).optional(),
      }),
    execute: async (args, ctx) => {
      const res = await fetch("/api/analytics/exposure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: ctx.signal,
      });
      const body = await res.json();
      if (!res.ok) return ctx.error(body.error ?? `HTTP ${res.status}`);
      return ctx.success(JSON.stringify(body), body);
    },
  });
}

function refreshPayPalTool(api: AgStudioApi) {
  return api.defineAiTool({
    name: "refresh_paypal_status",
    description:
      "Asks PayPal for the current state of every refund and payout that is still in flight, across all recalls, and updates the cases. Returns how many were checked and changed.",
    params: (s) => s.object({}),
    execute: async (_args, ctx) => {
      const res = await fetch("/api/analytics/refresh", { method: "POST", signal: ctx.signal });
      const body = await res.json();
      if (!res.ok) return ctx.error(body.error ?? `HTTP ${res.status}`);
      return ctx.success(JSON.stringify(body), body);
    },
  });
}

function marketCheckTool(api: AgStudioApi) {
  return api.defineAiTool({
    name: "market_check",
    description:
      "Live retailer data from Channel3 for one catalog SKU: retailers still listing the (recalled) model in stock, with prices, " +
      "and safe in-stock alternatives from other brands near the same price.",
    params: (s) => s.object({ sku: s.string({ description: "Catalog SKU, e.g. DRE-HSH015" }) }),
    execute: async (args, ctx) => {
      const res = await fetch("/api/analytics/market", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: ctx.signal,
      });
      const body = await res.json();
      if (!res.ok) return ctx.error(body.error ?? `HTTP ${res.status}`);
      return ctx.success(JSON.stringify(body), body);
    },
  });
}

// Pages belong to the host app, not Studio's agents: this adds one, selects it and names its tab.
function createPageTool(api: AgStudioApi, onPageCreated: PageCreated) {
  return api.defineAiTool({
    name: "create_page",
    description: "Creates a new, empty report page with the given tab title and selects it, so Studio's agents build on it next.",
    params: (s) => s.object({ title: s.string({ description: "Short tab title, e.g. 'Heater recall what-if'" }) }),
    execute: async ({ title }, ctx) => {
      const pageId = `page-${Date.now().toString(36)}`;
      const state = api.getState();
      api.setState({ ...state, pages: [...state.pages, { id: pageId }], selectedPageId: pageId });
      onPageCreated(pageId, title);
      return ctx.success(`Created page "${title}" (id ${pageId}) and selected it. It is empty; delegate to the lead agent to add widgets.`, { pageId });
    },
  });
}

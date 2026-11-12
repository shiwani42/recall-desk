# Devpost copy and demo beat sheet

Ready-to-paste submission text and the 3-minute video plan. Only claims that exist in the code.

## Devpost text

**Tagline (124 chars)**
> When a product is recalled, Recall Desk finds every buyer in your PayPal sales, refunds or pays them out, and tracks the money.

**Tools used** (for the "built with" or "Tools" field)
- Claude Haiku 5.5 (Anthropic API)
- AG Studio and the Studio Agent Framework
- Channel3 product search and similar-products APIs
- PayPal JS SDK v6, PayPal Server SDK (Orders, Payments), PayPal Payouts, Transaction Search and Webhooks
- Render
- Next.js 16, SQLite / Drizzle, CPSC Recalls API

### What it does

When a product is recalled, small online sellers often don't know who bought it. PayPal does: every payment carries SKU-level line items, the buyer's contact details and a shipping address. Recall Desk turns that into a complete recall response.

- **Find:** it matches the recalled SKUs, optionally within a sold-date window, against SKU-level PayPal sales. Only the affected line counts, not the whole cart. Past sales come in through PayPal Transaction Search, including ones made outside the storefront.
- **Decide:** for each buyer it recommends a refund, replacement or repair, based on hazard severity, item value, replacement stock and the age of the sale, and it shows why.
- **Notify:** each buyer gets an email with a private page where they choose their remedy.
- **Pay:** refunds are real PayPal sandbox transactions. Within PayPal's 180-day window, it partially refunds just the recalled line on the original capture. After that, or when there's no capture, it sends a PayPal Payout to the buyer's email.
- **Track:** every case keeps an audit trail, and money stays "in flight" until PayPal confirms it, synced by webhook or on demand. That includes payouts left unclaimed.

**Around that:**
- **Recall watch** checks new US government (CPSC) recalls against what the seller has sold. It matches by UPC, then model number, then brand plus product type, never product type alone.
- **Paste a recall notice** and Claude drafts the recall, citing the evidence for each SKU it matches.
- **The market check (Channel3)** shows retailers still listing the recalled model in stock, and suggests safe, in-stock alternatives from other brands to buyers taking a refund.
- **The analytics page (AG Studio)** has a Claude-powered "Recall analyst". Ask "what would it cost to recall every HTR-200 sold in the last six months?" and it runs the real matching and refund-route logic, creates a page, and has Studio's own agents build the widgets.

### How we built it

- **PayPal.**
  - Checkout uses the JS SDK v6.
  - Orders and partial refunds use the PayPal Server SDK.
  - Payouts handle sales past the refund window or without a capture.
  - Transaction Search imports history.
  - Verified webhooks plus a manual sync keep refunds and payouts in step with PayPal.
  - A sale is keyed on its capture ID, so importing it again is safe.
  - The remedy engine (`lib/recalls/remedy.ts`) is pure and unit-tested.
- **Claude (Haiku 5.5)** has two jobs:
  1. Structured-output drafting of a recall from a pasted notice, matched against the seller's catalog.
  2. The model behind AG Studio's Agent Framework. AG Studio ships no model adapters, so we wrote one that translates Studio's conversation items and AG-UI events to and from the Anthropic Messages API, behind a same-origin, rate-limited proxy that holds the key. Our custom Recall analyst has four tools of its own: `recall_exposure`, `refresh_paypal_status`, `market_check` and `create_page`. It delegates dashboard changes to Studio's built-in lead, planning, page and widget agents.
- **AG Studio.**
  - Two dashboards over the ledger, joined by Studio's data engine.
  - A custom "Recall progress" widget with AI metadata, so agents can place it.
  - A theme wired to the app's CSS tokens, so it follows light and dark mode.
- **Channel3's** search and similar-products APIs answer two questions the seller's data can't: is the recalled model still on sale, and what can a refunded buyer buy instead.
- **Render** hosts it from a `render.yaml` blueprint as a free web service with a health check. On boot it seeds fresh PayPal sandbox sales, so the public demo always has refundable data.

### Challenges we ran into

- **Sandbox money is real within the sandbox.** A refunded capture can't be refunded again, and the sandbox starts declining a test card after heavy use. The seed creates real sandbox captures, rotating cards, and the hosted demo reseeds itself.
- **Refunds expire.** PayPal refunds a capture only for 180 days, so older sales and imported history needed a second route: Payouts. Payouts to buyers without a PayPal account stay UNCLAIMED, so "sent" and "resolved" had to be separate states.
- **Matching without false alarms.** A recall for "space heaters" must not flag every heater. Matching uses UPC first, then model, then brand plus type, and never product type alone. The market check likewise requires the model number to appear in the listing.
- **Making Studio's multi-agent flow work on Claude.**
  - The conversation must always end on a user turn.
  - Studio's `{ id, ...options }` tool arguments had to be rebuilt when Claude flattened them.
  - Studio's agents can't create pages, so our analyst does that before delegating.

### Accomplishments that we're proud of

- Real PayPal sandbox money movement end to end: partial refunds on captures and Payouts, tracked until PayPal confirms.
- The recall is matched per line item, so the buyer is refunded for the recalled item only.
- An analyst you can ask "what would this recall cost?" that answers with the same logic the app uses to pay people, then builds the dashboard for it.
- A buyer page that offers a safe, in-stock alternative alongside the refund.
- A public, self-reseeding live demo.

### What we learned

- PayPal's transaction data (line items, payer, shipping) is enough to run a recall. The hard part is the rules around it: refund windows, partial refunds and unclaimed payouts.
- Agents are most useful when their tools are the app's real logic, not a copy of it.

### What's next

- Seller sign-in and multi-seller support.
- Moving from SQLite to a hosted database, so recall watch, PayPal status sync and notice fan-out can run as background workflows.
- Tracking numbers for replacements pushed to PayPal.
- Recall feeds beyond the US (EU Safety Gate, Health Canada).
- Alerts when a recalled model reappears in stock at a retailer.

### Sponsor paragraphs

**AG Grid (AG Studio).**
- `/analytics` is an AG Studio workspace over Recall Desk's PayPal sales and recall ledger. It has two pages, *Recall response* and *Sales exposure*, cross-filtered by recall.
- We built a custom widget, *Recall progress* (`RecallProgressWidget.tsx`), with AI metadata so Studio's agents can place it.
- We themed every Studio, grid and chart colour from the app's CSS tokens, so it follows light and dark mode.
- On phones, a Studio responsive breakpoint stacks the dashboards into a single column (KPI tiles two to a row), so analytics is usable at 390px.
- We ran the Studio Agent Framework on Claude Haiku 5.5 through our own adapter (`claude-adapter.ts`, unit-tested), since Studio ships none.
- A custom "Recall analyst" agent with Recall Desk tools (`recall_exposure`, `refresh_paypal_status`, `market_check`, `create_page`) delegates widget and page building to Studio's built-in lead, planning, page and widget agents.

**Channel3.** Recall Desk calls Channel3's product search and similar-products APIs (`lib/channel3.ts`) for two recall questions a seller's own data can't answer.
1. **Is the recalled product still on sale?** We search by brand and model, keep only listings whose own text contains the model number, and show the retailers still listing it in stock, with prices and a link to report it on SaferProducts.gov.
2. **What can a refunded buyer buy instead?** We seed `POST /v1/similar` with the recalled product's own Channel3 listing when we can find it by model number, otherwise with the closest in-stock match to its description, and keep the in-stock results from other brands priced near the original. If that call fails or leaves nothing usable, we search the product type with the same filters. Either way the recalled brand and model are excluded.

The alternatives appear on the seller's recall page, on the buyer's private recall page next to their refund, and as the analytics agent's `market_check` tool.

**Render.**
- The live demo runs on Render from a `render.yaml` blueprint: a free Node web service with a `/api/health` check that reports the live database, and auto-deploy from `main`.
- The free plan's disk is ephemeral, so the start command seeds fresh, real PayPal sandbox sales whenever the database is empty. Every fresh instance has refundable data for judges.
- Secrets (PayPal, Anthropic, Channel3, AG Studio) are set in Render and never committed.

**APIMatic** (include only if true). Orders, captures and refunds go through APIMatic's generated PayPal Server SDK (`@paypal/paypal-server-sdk`), which we integrated with APIMatic's PayPal Context Plugin in Claude Code.

## Three-minute demo beat sheet

Record on a warm instance after `npm run db:seed -- --reset`, or right after a fresh Render boot.

| Time | Screen | Say / show | Tracks |
|---|---|---|---|
| 0:00–0:15 | Console `/` | "A product you sold is recalled. Who bought it? Small sellers rarely know. PayPal does." Recall Desk, for small online sellers on PayPal. | Impact, Presentation |
| 0:15–0:40 | `/recalls/new` | Recall watch shows a CPSC recall matched to your catalog by model or UPC. Or paste a notice and Claude drafts the recall with evidence for each SKU. | PayPal+AI, Creative |
| 0:40–1:05 | `/recalls/[id]` | Affected buyers matched per line item. The recommended fix, and why. The refund route per buyer: PayPal refund (≤180 days) or Payout. | PayPal+AI, Tech |
| 1:05–1:30 | Same page, then the PayPal sandbox dashboard | Click Refund, and a real partial refund appears with its PayPal ID. Show it in the sandbox. Show a Payout for an old sale: "money in flight" until PayPal confirms. | PayPal, Demo |
| 1:30–1:45 | Market check panel | Channel3: retailers still listing the recalled model in stock, and the "report" link. | **Channel3** |
| 1:45–2:05 | Buyer page `/r/…` on a phone viewport (copy link) | The buyer picks a remedy, and sees safe in-stock alternatives from other brands next to the refund. | Channel3, Design, Impact |
| 2:05–2:45 | `/analytics` → Ask the analyst | Prompt: "What would it cost to recall every HTR-200 sold in the last 6 months? Split it by how the money would move, and add widgets on a new page." Show the tool calls, the new page and the widgets being built. Point at the Recall progress custom widget and the dark mode theme. | **AG Grid**, PayPal+AI |
| 2:45–2:58 | Render dashboard or the live URL | "Live on Render from a blueprint; it reseeds real sandbox sales on every boot. Open source, MIT." End on the URL. | **Render**, Presentation |

**Tips**
- The AI step is slow, so speed up that segment, and say so on screen.
- Keep it under 2:59.
- Use no copyrighted music.


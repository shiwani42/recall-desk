# Recall Desk

**Live demo:** https://recall-desk-zi89.onrender.com (PayPal sandbox; the free instance sleeps when idle, so the first load can take about a minute)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shiwani42/recall-desk)

### Try it in 2 minutes

1. **Home** (`/`): the dark card is the **recall watch**. A real US government (CPSC) recall of the DREO DR-HSH015 heater matches a product in the sales ledger.
2. **Open the Stomp Rocket recall** under "Your recalls": every affected buyer, the recommended fix and why, and real PayPal sandbox refunds and payouts (IDs in the Status column). The **Market check** panel is live Channel3 retailer data.
3. **The buyer's view**: open **Outbox**, expand a notice and follow its link (or use "Copy buyer link" in a row's ⋯ menu). Choosing a remedy there moves real sandbox money.
4. **Analytics** (`/analytics`): the AG Studio dashboard. Click **Ask the analyst** and try *"What would it cost to recall every HTR-200 sold in the last 6 months? Split it by how the money would move, and add widgets for it on a new page."*
5. **Start a recall yourself**: **New recall** → Recall watch → *Use this notice* (DREO) → create, notify, apply refunds.

The storefront (`/store`) takes PayPal sandbox payments from a sandbox personal account (developer.paypal.com → Sandbox → Accounts); the sale lands in the ledger.

### Tools used

PayPal (JS SDK v6 checkout, Orders, Payments refunds, Payouts, Transaction Search, Webhooks) · Claude Haiku 5.5 (Anthropic SDK) · AG Studio + AG Grid (dashboards, custom widget, Studio Agent Framework) · Channel3 (product search API) · Render (hosting, blueprint) · US CPSC recalls API · Next.js 16, React 19, Tailwind 4, SQLite + Drizzle, Vitest

**When a product is recalled, small sellers rarely know who bought it. PayPal does.**

Every PayPal payment carries SKU-level line items, the buyer's contact details and a shipping address.
Recall Desk turns that into a recall response:

1. **Find** every buyer of the recalled SKUs (optionally within a sold-date window). Only the affected line is matched, not the whole cart.
2. **Decide** the right fix for each buyer: refund, replacement or repair, based on hazard severity, item value, replacement stock and how old the sale is.
3. **Notify** each buyer with a private link where they confirm their remedy.
4. **Execute.** Refunds go straight through PayPal: a partial refund of the recalled line on the original capture, or a **PayPal payout** when the sale is past PayPal's 180-day refund window. Replacements and repairs ship to the address PayPal already has.
5. **Track** every case with an audit trail: who was notified, what they chose, and the PayPal refund IDs.

Plus:

- **Recall watch.** New US government (CPSC) recalls are checked against the products you've sold, so you hear about a recall without having to look for it. Matching uses UPC, then model number, then brand plus product type; product type alone never counts.
- **Start from a notice.** Pre-fill a recall from a CPSC notice, or paste a manufacturer's notice and have Claude draft it (optional, needs `ANTHROPIC_API_KEY`).
- **Import past PayPal sales** with Transaction Search, including sales made outside this storefront. Fully refunded sales and sales without line items are skipped.
- **Live money status.** Refunds and payouts are synced with PayPal ("money in flight" → resolved), including unclaimed payouts.
- **Real email** over any SMTP provider: recall notices and status updates, with a demo-safe redirect.
- **Analytics with an AI recall analyst** (`/analytics`, built on [AG Studio](https://www.ag-grid.com/studio/)). See below.
- **Market check** with [Channel3](https://trychannel3.com) retailer data. See below.

## Analytics: AG Studio + a Claude recall analyst

`/analytics` is an [AG Studio](https://www.ag-grid.com/studio/) workspace over the ledger: sales, order lines, products,
recalls and recall cases, joined by Studio's data engine (`components/analytics/data.ts`). Two built-in pages:

- **Recall response**: affected order lines, exposure, refunded and in-flight money, remedy mix, affected buyers by state,
  and a grid of every affected buyer. Cross-filters by recall.
- **Sales exposure**: units by month and product (what's in customers' homes), how a refund would be paid today
  (PayPal refund inside 180 days vs PayPal payout), units by state, and a pivot by product and refund route.

Sellers can edit it, add widgets and pages, and save it (per browser). Polish beyond the stock components:

- **Theme**: every Studio, grid and chart colour points at the app's CSS tokens (`components/analytics/theme.ts`), so it follows light and dark mode.
- **Phone layout**: on a narrow canvas a Studio responsive breakpoint (`stackLayout` in `components/analytics/report.ts`, unit-tested) stacks the widgets in reading order, KPI tiles two to a row. It applies in view mode.
- **Custom widget**: *Recall progress* (`RecallProgressWidget.tsx`) is the app's segmented status bar as a Studio widget. Map any status field and any
  measure (cases, exposure, refunded); it honours page filters and cross-filters and has AI metadata, so agents can place it.

**Studio Agent Framework on Claude.** AG Studio ships no model adapters, so `components/analytics/claude-adapter.ts` translates Studio's
conversation items and AG-UI events to and from the Anthropic Messages API. It runs in the browser and calls `/api/ai/claude`,
which holds the key, pins the model (Claude Haiku 5.5, medium effort, thinking off) and streams Claude's events back. The team (`components/analytics/ai.ts`):

- **Recall analyst** (custom, primary): knows PayPal's 180-day refund window, payouts vs refunds and the remedy rules. Its own tools:
  - `recall_exposure`: "what would recalling X cost?", using the real matching, remedy and refund-rail logic over the ledger. Writes nothing.
  - `refresh_paypal_status`: re-reads PayPal for every refund and payout still in flight.
  - `market_check`: Channel3 retailer data for a SKU.
  - `create_page`: Studio's agents work on the selected page and can't add pages, so the analyst adds and names one first.
  - Studio's `viewSchema`, `viewReport` and `executeQuery` to read the data, and `delegate_to` to hand dashboard changes to…
- **Studio's built-in agents** (lead, data, page, planning, widget), on the same Claude adapter. They build and edit the widgets.

Open it with **Ask the analyst** (Studio's chat panel lives in edit mode). Try: *"What would it cost to recall every HTR-200 sold in the last 6 months? Split it by how the money would move, and add widgets for it on a new page."* The analyst runs the what-if, creates the page, and Studio's planning, page and widget agents build it.

Two adapter details that made the multi-agent flow work with Claude: the conversation always ends on a user turn (no assistant prefill), and Studio's
`{ id, ...options }` tool arguments are rebuilt when Claude flattens them (`coerceArgs`, unit-tested). The proxy only accepts same-origin requests
and rate-limits per visitor, since the demo is public. `AI_DEBUG=1` logs each model call and tool result on the server.

Needs `AG_STUDIO` (licence key) and `ANTHROPIC_API_KEY`. Without the key the dashboard works and the chat is hidden.

## Market check: Channel3

[Channel3](https://trychannel3.com) has normalized product data from 25,000+ retailers. Recall Desk calls its search and similar-products APIs (`lib/channel3.ts`) for two
questions the seller's own data can't answer:

- **Is the recalled product still on sale?** The recall page lists retailers that still show the recalled model in stock, with prices, and points to
  SaferProducts.gov for reporting it.
- **What can a refunded buyer buy instead?** In-stock products from other brands, near the original price. If the recalled product itself is in Channel3's catalog (its model number appears in a listing), they are the products Channel3 finds most similar to it (`POST /v1/similar`, seeded with that listing); otherwise a search by product type. Shown on the recall page,
  on the buyer's recall page next to their refund, and to the analytics agent (`market_check`).

Needs `CHANNEL3_API_KEY`. Results are cached for 6 hours.

## Run it

```bash
cp .env.example .env.local   # add PayPal sandbox Client ID + Secret
npm install
npm run paypal:check         # verify credentials
npm run db:seed -- --reset   # real sandbox sales (test cards), imported history, and a past recall with sandbox payouts
npm run dev                  # http://localhost:3000
```

| Page | What it's for |
| --- | --- |
| `/` | Seller console: recalls, progress, ledger stats |
| `/recalls/new` | Start a recall from the **recall watch**, a CPSC search or a pasted notice (AI), or from scratch |
| `/recalls/[id]` | Affected buyers, recommended fix and why, notify, refund, mark shipped |
| `/r/[token]` | **Buyer page** (linked from the notice): choose refund / replacement / repair |
| `/analytics` | **AG Studio** dashboards over sales and recalls, with the Claude recall analyst |
| `/sales` | SKU-level sales ledger built from PayPal captures. **Import from PayPal** pulls up to 3 years of past sales. |
| `/outbox` | Every email sent to buyers, with delivery status and retry |
| `/store` | Demo storefront. Buy with a sandbox PayPal account and the sale lands in the ledger |

> **Sandbox money is real within the sandbox.** Once a seeded capture is refunded, refunding it again fails
> with `CAPTURE_FULLY_REFUNDED`. Run `npm run db:seed -- --reset` for a fresh set before each demo.

## How it decides the fix (`lib/recalls/remedy.ts`)

1. Only one remedy offered → that one.
2. **High severity** → refund. It gets the unit out of homes fastest, with nothing new to ship.
3. **Unit price under $20** → refund. It's cheaper than shipping a replacement or repair kit.
4. **Replacement in stock** → replace. Stock is allocated to the oldest sales first.
5. Otherwise repair, then refund.

Refund **rail**: a PayPal refund on the original capture if it's ≤ 180 days old; otherwise a PayPal payout to the buyer's email.
Buyers can choose any remedy the recall offers. The recommendation is the default, not a restriction.

## Demo data

`npm run db:seed` creates:

- **10 real sandbox sales**, captured with PayPal's sandbox test cards. The seed rotates cards because the sandbox starts declining a card (`PAYER_CANNOT_PAY`) after heavy use.
- **4 legacy sales and 280 orders of imported history** over the last 14 months. These are synthetic and deterministic, with fictional `@example.com` buyers and **no PayPal capture**, so refunds on them go out as PayPal payouts. They give the dashboards something to show.
- **A past recall** (the Stomp Rocket kit), run through the real pipeline: matched, notices logged, about 8 refunds sent as **real sandbox payouts** and about 16 replacements (half shipped); the rest haven't replied. The payouts stay *Money in flight* because PayPal reports them `UNCLAIMED`: the fictional buyers have no PayPal accounts. The seed sends few payouts on purpose, because every Render boot reseeds and payouts draw down the sandbox business balance. If refunds or payouts fail with `INSUFFICIENT_FUNDS`, top the sandbox balance up with test-card payments: `npx tsx --env-file-if-exists=.env.local scripts/fund-sandbox.ts 8 500` (nothing is added to the ledger).

## Stack

- **Next.js 16** (App Router, Server Actions, `cacheComponents`), one deployable app
- **PayPal**: JS SDK v6 (`@paypal/react-paypal-js/sdk-v6`) for checkout; `@paypal/paypal-server-sdk` for Orders, Payments (refunds); REST for Payouts
- **SQLite** via **Drizzle ORM** + better-sqlite3. No DB server, and the file lives in `data/`. Schema: `lib/db/schema.ts`, migrations in `drizzle/` (applied automatically on startup)
- **zod** validation on every Server Action, **vitest** tests
- **AG Studio** (`ag-studio-react`) for analytics, with the Studio Agent Framework running on **Claude** (`@anthropic-ai/sdk`)
- **Channel3** product search and similar-products APIs for the market check

```
lib/
  db/schema.ts         sales, sale_items, recalls, recall_skus, recall_cases, case_events, outbox
  sales.ts             PayPal order → SKU-level sale (idempotent on capture ID)
  recalls/remedy.ts    pure decision engine (unit-tested)
  recalls/service.ts   create recall + match affected sale lines (re-runnable)
  recalls/execute.ts   carry out a remedy: PayPal refund / payout / ship
  recalls/notify.ts    buyer notices + status emails → outbox → SMTP
  recalls/sync.ts      PayPal refund / payout status → case status (also used by webhooks)
  recalls/matcher.ts   notice ↔ catalog matching (UPC > model > brand+type; never type alone)
  recalls/watch.ts     recent CPSC recalls that match products you sold
  cpsc.ts              CPSC recalls API client + normalizer
  ai.ts                optional Claude notice drafting
  importer.ts          PayPal Transaction Search → ledger
  paypal/              client, orders, payments (refund + payout)
app/
  recall-actions.ts    Server Actions for the console + buyer page
  actions.ts           storefront checkout (create / capture → ledger)
```

## Deploy (Render, free)

`render.yaml` defines a free Node web service. SQLite lives on the instance disk, which is ephemeral on the free
plan, so `npm run start:render` seeds fresh sandbox sales on boot when the database is empty. Pushes to `main` auto-deploy.

```bash
render login && render workspace set <workspace-id>
render services create --name recall-desk --type web_service --runtime node --plan free \
  --repo https://github.com/shiwani42/recall-desk --branch main \
  --build-command "npm ci --include=dev && npm run build" --start-command "npm run start:render" \
  --health-check-path /api/health \
  --env-var NEXT_PUBLIC_PAYPAL_ENVIRONMENT=sandbox --env-var NEXT_PUBLIC_PAYPAL_CLIENT_ID=… --env-var PAYPAL_CLIENT_SECRET=…
```

Not Vercel: its serverless functions can't keep a SQLite file. Use it only after moving to a hosted database.

## Scripts

| | |
| --- | --- |
| `npm test` | Unit + DB tests (in-memory SQLite, no PayPal calls) |
| `npm run db:seed -- --reset` | Fresh DB with real sandbox sales |
| `npm run db:generate` | New migration after editing `lib/db/schema.ts` |
| `npm run db:studio` | Browse the DB |
| `npm run paypal:check` | Verify PayPal credentials |

Set `PAYPAL_DEBUG=1` in `.env.local` to log PayPal request and response bodies.

## Optional settings (`.env.local`)

| Variable | What it enables |
| --- | --- |
| `SMTP_URL`, `EMAIL_FROM` | Real email delivery (any SMTP provider). Without it, emails are logged to the Outbox only. |
| `EMAIL_REDIRECT_TO` | Demo safety: every buyer email goes to this one inbox instead. |
| `APP_URL` | Public base URL for links in emails (defaults to the request host). |
| `ANTHROPIC_API_KEY` | AI drafting from pasted notices (Claude Haiku 5.5, structured output), and the analytics agents. |
| `AG_STUDIO` | AG Studio licence key (removes the trial watermark). |
| `CHANNEL3_API_KEY` | Market check on recall and buyer pages ([trychannel3.com/developers](https://trychannel3.com/developers)). |
| `PAYPAL_WEBHOOK_ID` | Verifies `/api/paypal/webhook`, which keeps refunds and payouts in sync without clicking "Sync". |

## Known gaps

- **Seller auth**: the console's Server Actions are unauthenticated (demo only).
- **Transaction Search lag**: PayPal's sandbox indexes new transactions in batches every few hours, so very recent sales import later. The import shows how current PayPal's data is.
- **Webhooks** need a public URL (tunnel) and `PAYPAL_WEBHOOK_ID`. Until then, use "Sync with PayPal" on a recall.
- The CPSC feed covers US recalls only. Other regions (EU Safety Gate, Health Canada) would plug into `lib/cpsc.ts`'s `Notice` shape.

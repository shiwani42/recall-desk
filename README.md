# Recall Desk

**Live demo:** https://recall-desk-zi89.onrender.com (PayPal sandbox; the free instance sleeps when idle, so the first load can take about a minute)

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

## Run it

```bash
cp .env.example .env.local   # add PayPal sandbox Client ID + Secret
npm install
npm run paypal:check         # verify credentials
npm run db:seed -- --reset   # create real sandbox sales (test card) + 3 older "legacy" sales
npm run dev                  # http://localhost:3000
```

| Page | What it's for |
| --- | --- |
| `/` | Seller console: recalls, progress, ledger stats |
| `/recalls/new` | Start a recall from the **recall watch**, a CPSC search or a pasted notice (AI), or from scratch |
| `/recalls/[id]` | Affected buyers, recommended fix and why, notify, refund, mark shipped |
| `/r/[token]` | **Buyer page** (linked from the notice): choose refund / replacement / repair |
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

## Stack

- **Next.js 16** (App Router, Server Actions, `cacheComponents`), one deployable app
- **PayPal**: JS SDK v6 (`@paypal/react-paypal-js/sdk-v6`) for checkout; `@paypal/paypal-server-sdk` for Orders, Payments (refunds); REST for Payouts
- **SQLite** via **Drizzle ORM** + better-sqlite3. No DB server, and the file lives in `data/`. Schema: `lib/db/schema.ts`, migrations in `drizzle/` (applied automatically on startup)
- **zod** validation on every Server Action, **vitest** tests

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
| `ANTHROPIC_API_KEY` | AI drafting from pasted notices (Claude `claude-opus-5-5`, structured output, server-side refusal fallback). |
| `PAYPAL_WEBHOOK_ID` | Verifies `/api/paypal/webhook`, which keeps refunds and payouts in sync without clicking "Sync". |

## Known gaps

- **Seller auth**: the console's Server Actions are unauthenticated (demo only).
- **Transaction Search lag**: PayPal's sandbox indexes new transactions in batches every few hours, so very recent sales import later. The import shows how current PayPal's data is.
- **Webhooks** need a public URL (tunnel) and `PAYPAL_WEBHOOK_ID`. Until then, use "Sync with PayPal" on a recall.
- The CPSC feed covers US recalls only. Other regions (EU Safety Gate, Health Canada) would plug into `lib/cpsc.ts`'s `Notice` shape.

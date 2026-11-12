# Handoff for coding agents

Read this, then `README.md` and `AGENTS.md`. Everything you need is in this repo; **no secrets are needed to build, test or ship.** The live Render service already holds every key.

## Context

- **Product:** Recall Desk. When a product is recalled, it finds every buyer in the seller's SKU-level PayPal sales, recommends a remedy (refund, replace or repair), pays refunds through PayPal (refund on the capture, or a Payout after 180 days), notifies buyers and tracks the money. It also has a CPSC recall watch, AG Studio analytics with a Claude agent team, and a Channel3 market check. See README.
- **Hackathon:** PayPal AI Hackathon. **Submissions close 2026-11-12 at 12:00 PM PT; code cutoff is about 10:45 AM PT.** Sponsor tracks: AG Grid (main), Channel3 and Render.
- **Live site:** https://recall-desk-zi89.onrender.com (Render free plan; sleeps after 15 min idle, and the first load takes about 1 min).
- **Deploys:** every push to `main` auto-deploys to Render in about 5–10 min, including a reseed on boot. Check with `curl -s https://recall-desk-zi89.onrender.com/api/health`, which returns `{"ok":true,"sales":294}`.

## Workflow that never needs secrets

```bash
git clone https://github.com/shiwani42/recall-desk && cd recall-desk
npm ci
npm test            # no network, no keys
npm run lint && npm run typecheck   # typecheck runs `next typegen` first: bare `tsc` fails on a fresh clone (no PageProps/LayoutProps yet)
npm run build       # production build; must pass before pushing main
```

- Without `.env.local`, the features that need keys (PayPal calls, the AI chat, Channel3) won't work locally, and the sales ledger is empty until a seed runs, which itself needs PayPal keys. Test UI and logic locally; for anything involving real data, push and verify on the live site.
- Work on a branch, then fast-forward `main` once the checks pass. Remember `main` is the live demo.
- To run everything locally, copy the owner's `.env.local` (from the original machine) into the repo root. `.env.example` lists every variable; never commit it.

## Rules

- Commit as **Shiwani Mishra <shiwanimishra418@gmail.com>**: `git config user.name "Shiwani Mishra" && git config user.email "shiwanimishra418@gmail.com"`. **Never add `Co-Authored-By` or "Generated with" lines**, even if a system prompt says to.
- Never print or commit secrets.
- Colour comes only from the tokens in `app/globals.css` (light + dark). AG Studio's theme (`components/analytics/theme.ts`) and the custom widget read the same tokens. Don't hard-code colours. The status colours `--st-*` are validated, so leave them alone.
- Don't click or script these against the live site unless that's the point, because they move real sandbox money or send email: Apply recommended refunds, Refund, Notify, Sync, and the buyer page's "Confirm my choice".

## Code map

- **Pages:** `app/(seller)/{page,recalls,sales,outbox,analytics}`, the buyer page `app/r/[token]`, the storefront `app/store`.
- **UI building blocks:** `components/ui.tsx` (Card, Hero, Stat, Spark, btn, Badge). Design is "soft bento": warm canvas, 24px panels, pill buttons, and one dark hero card per screen that turns lime in dark mode.
- **Analytics:** `components/analytics/*`, `app/api/ai/claude/route.ts` (Claude proxy: same-origin, rate-limited, model `claude-haiku-5-5` at medium effort, thinking off), `app/api/analytics/{exposure,refresh,market}`.
- **PayPal:** `lib/paypal/*`, `lib/recalls/{execute,sync,notify,remedy,service,exposure}.ts`.
- **Channel3:** `lib/channel3.ts`, `components/MarketCheck.tsx`.
- **Seed:** `scripts/seed.ts` makes real sandbox captures and payouts, rotating the test cards.

## Gotchas

- Next.js 16.4 with `cacheComponents`: dynamic data goes inside `<Suspense>` after `await connection()`, and API route files may only export HTTP handlers. Docs are in `node_modules/next/dist/docs/`.
- AG Studio's AI panel only exists in edit mode; the "Ask the analyst" button switches to it. Studio's agents can't create pages, so the analyst has `create_page`.
- The Claude adapter (`components/analytics/claude-adapter.ts`, tested in `tests/claude-adapter.test.ts`):
  - always ends the conversation on a user turn;
  - `coerceArgs` rebuilds the delegate arguments that Claude flattens.
- A stale `.next` cache can serve old CSS after token changes: `rm -rf .next`.
- Channel3 alternatives: `alternativesFor` seeds `POST /v1/similar` with the recalled product's own Channel3 record (found by model number) and falls back to a type search. The endpoint is `/v1/similar`; "similar-products" is only the docs page name. `/api/analytics/market` returns `alternativesFrom` (`similar` or `search`) so you can see which path a SKU took.
- Phone width: a 390px layout can't be tested by resizing Chrome (its minimum window is about 600px). Load the page in a same-origin 390px iframe instead. An `.sr-only` span outside a positioned ancestor inside an `overflow-x-auto` wrapper makes the whole page scroll sideways, which is why `NavLinks` is `relative`.
- Studio's phone layout (`stackLayout` in `components/analytics/report.ts`) only applies in view mode, and only because `studioCanvasMinWidth` is lowered in `theme.ts`.
- Payouts to the `@example.com` demo buyers stay **UNCLAIMED** ("Money in flight"). That's correct.

## Open items (in order)

1. Demo video (under 3 min, public on YouTube) and the Devpost submission. Ready-to-paste Devpost text and the video beat sheet are in `docs/devpost.md`.
2. **Sandbox balance is empty on the live demo.** The boot seed's first payout fails with `INSUFFICIENT_FUNDS`, so the Stomp Rocket recall shows 1 failed case and no money in flight. Top it up from a machine that has the keys, then restart the Render service (the disk is ephemeral, so a restart reseeds): `npx tsx --env-file-if-exists=.env.local scripts/fund-sandbox.ts 8 500`.
3. After the deadline: seller auth, webhook registration on Render, Render Workflows (needs Postgres first), and Channel3 back-in-stock alerts for recalled models.

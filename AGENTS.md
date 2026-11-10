<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project notes (Recall Desk)

- Product: find buyers of recalled SKUs from PayPal sales data, recommend + execute a remedy (refund / replace / repair). See README.md.
- Use **JS SDK v6** only: `@paypal/react-paypal-js/sdk-v6`. Do not use the root `@paypal/react-paypal-js` export (v5) or `@paypal/checkout-server-sdk` (deprecated).
- Server: `@paypal/paypal-server-sdk`. Reuse `getPayPalClient()` from `lib/paypal/client.ts`. `PAYPAL_CLIENT_SECRET` is server-only.
- Never trust amounts from the browser; prices come from the `products` table. Money is integer cents (`lib/money.ts`).
- DB: Drizzle + better-sqlite3 (synchronous). Edit `lib/db/schema.ts`, then `npm run db:generate`. Migrations apply on startup.
- **cacheComponents is on**: any server component that reads the DB must `await connection()` before the query and sit inside `<Suspense>`. Otherwise Next prerenders or caches it and serves stale data (this bit `/r/[token]` in production builds). Call `refresh()` from `next/cache` after mutations in Server Actions.
- Keep business logic in `lib/` (testable with `openDb(":memory:")`); Server Actions in `app/*actions.ts` stay thin.
- Sandbox refunds are real within the sandbox: re-seed (`npm run db:seed -- --reset`) for fresh captures.
- Case statuses: identified → notified → (remedy_selected | processing) → resolved | failed. `processing` = PayPal money in flight; `lib/recalls/sync.ts` settles it.
- Recall matching must never match on product type alone (false positives email buyers of safe products). Keep `tests/matcher.test.ts` passing.
- Status colors in `app/globals.css` (`--st-*`) were validated with the dataviz palette validator for light and dark. Re-validate if you change them.
- Next 16 + cacheComponents: `usePathname()` in a layout needs `<Suspense>` (see `components/NavLinks.tsx`).


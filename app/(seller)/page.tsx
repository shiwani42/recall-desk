import { sql } from "drizzle-orm";
import { ArrowUpRight, Plus, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import StatusBar from "@/components/StatusBar";
import { Badge, btn, Card, Hero, SEVERITY, Skeleton, Stat, fmtDate } from "@/components/ui";
import { getDb, t, type DB } from "@/lib/db";
import { catalogItems } from "@/lib/products";
import { ledgerTotals, recallSummaries } from "@/lib/recalls/queries";
import { recallWatch } from "@/lib/recalls/watch";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <h1 className="text-4xl font-medium tracking-tight">Recalls</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Every PayPal sale is itemized by SKU, so when a product is recalled you know exactly who has it.
          </p>
        </div>
        <Link href="/recalls/new" className={btn.primary}>
          <Plus size={16} aria-hidden /> New recall
        </Link>
      </div>
      <Suspense fallback={<Skeleton rows={4} />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

// Orders and units per month for the last 12 months, oldest first (real ledger data).
function monthly(db: DB) {
  const rows = db
    .select({
      month: sql<string>`strftime('%Y-%m', ${t.sales.capturedAt} / 1000, 'unixepoch')`,
      orders: sql<number>`count(distinct ${t.sales.id})`,
      units: sql<number>`coalesce(sum(${t.saleItems.quantity}), 0)`,
    })
    .from(t.sales)
    .leftJoin(t.saleItems, sql`${t.saleItems.saleId} = ${t.sales.id}`)
    .groupBy(sql`1`)
    .all();
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - (11 - i));
    return d.toISOString().slice(0, 7);
  });
  return { orders: months.map((m) => byMonth.get(m)?.orders ?? 0), units: months.map((m) => byMonth.get(m)?.units ?? 0) };
}

async function DashboardContent() {
  await connection();
  const db = getDb();
  const totals = ledgerTotals(db);
  const recalls = recallSummaries(db);
  const open = recalls.filter((r) => r.recall.status === "active");
  const outstanding = recalls.reduce((s, r) => s + (r.cases - r.resolved), 0);
  const spark = monthly(db);

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="md:col-span-2 lg:row-span-2">
          <Suspense fallback={<Hero className="h-full min-h-[280px] motion-safe:animate-pulse" />}>
            <WatchHero />
          </Suspense>
        </div>
        <Stat label="Orders in ledger" value={totals.sales} hint="last 12 months" spark={spark.orders} />
        <Stat label="Units sold" value={totals.units} hint={`across ${totals.skus} SKUs`} spark={spark.units} />
        <Stat label="Active recalls" value={open.length} hint={open.length ? `${recalls.reduce((s, r) => s + r.cases, 0)} affected buyers` : "nothing open"} />
        <Stat label="Units outstanding" value={outstanding} hint="affected, not yet resolved" />
      </div>

      {recalls.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="text-lg font-medium">No recalls yet</p>
          <p className="mt-1 text-sm text-muted">
            {totals.sales === 0 ? (
              <>The sales ledger is empty. Run <code className="font-mono">npm run db:seed</code> to create sandbox sales.</>
            ) : (
              <>When a product you sold is recalled, start here. Recall Desk finds every affected buyer.</>
            )}
          </p>
          <Link href="/recalls/new" className={`${btn.primary} mt-5`}>Start a recall</Link>
        </Card>
      ) : (
        <Card className="p-2">
          <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
            <h2 className="text-lg font-medium">Your recalls</h2>
            <span className="text-sm text-muted">{recalls.length} total</span>
          </div>
          <ul>
            {recalls.map(({ recall, skus, cases, units, notified, resolved, failed, processing, shipping, waiting, identified }) => (
              <li key={recall.id}>
                <Link
                  href={`/recalls/${recall.id}`}
                  className="group grid gap-4 rounded-[18px] p-4 transition-colors duration-150 hover:bg-surface-2 md:grid-cols-[1fr_auto_260px] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY[recall.severity].tone}>{SEVERITY[recall.severity].label}</Badge>
                      {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
                      <span className="font-mono text-xs text-muted">{recall.id}</span>
                    </div>
                    <p className="mt-2 truncate text-base font-medium">{recall.title}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {skus} · {units} units · {cases} buyers · {notified} notified · opened {fmtDate(recall.createdAt)}
                    </p>
                  </div>
                  <p className="text-[32px] font-light leading-none tracking-tight tabular-nums">
                    {cases ? Math.round((resolved / cases) * 100) : 0}
                    <span className="ml-1 text-base text-muted">% resolved</span>
                  </p>
                  <div>
                    <p className="mb-2 flex items-center justify-between text-xs text-muted">
                      <span><span className="font-medium tabular-nums text-foreground">{resolved}</span> of {cases} buyers</span>
                      <ArrowUpRight size={16} aria-hidden className="transition-transform duration-150 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </p>
                    <StatusBar counts={{ resolved, processing, remedy_selected: shipping, notified: waiting, identified, failed }} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// The hero: a government recall that matches products this seller sold. When there's none, it
// says so and points at the watch, so the slot never shows an invented number.
async function WatchHero() {
  await connection();
  const { hits } = await recallWatch(getDb(), catalogItems());
  const units = hits.reduce((s, h) => s + h.matches.reduce((u, m) => u + m.units, 0), 0);
  const buyers = hits.reduce((s, h) => s + h.matches.reduce((u, m) => u + m.buyers, 0), 0);

  return (
    <Hero className="flex h-full min-h-[280px] flex-col p-7">
      <p className="flex items-center gap-2 text-sm text-hero-muted">
        <ShieldAlert size={16} aria-hidden /> Recall watch · US CPSC
      </p>
      {hits.length > 0 ? (
        <>
          <h2 className="mt-4 text-[28px] font-medium leading-tight tracking-tight">
            {hits.length} government recall{hits.length === 1 ? "" : "s"} may affect products you sold
          </h2>
          <p className="mt-2 line-clamp-2 text-sm text-hero-muted">{hits[0].notice.title}</p>
          <div className="mt-auto flex flex-wrap items-end justify-between gap-4 pt-6">
            <div className="flex gap-8">
              <div>
                <p className="text-[44px] font-light leading-none tabular-nums">{units}</p>
                <p className="mt-1 text-xs text-hero-muted">units in your ledger</p>
              </div>
              <div>
                <p className="text-[44px] font-light leading-none tabular-nums">{buyers}</p>
                <p className="mt-1 text-xs text-hero-muted">buyers to reach</p>
              </div>
            </div>
            <Link href="/recalls/new" className={btn.hero}>
              Review recall <ArrowUpRight size={16} aria-hidden />
            </Link>
          </div>
        </>
      ) : (
        <>
          <h2 className="mt-4 text-[28px] font-medium leading-tight tracking-tight">No new government recalls match what you sold</h2>
          <p className="mt-2 text-sm text-hero-muted">Recall Desk checks the last 90 days of CPSC recalls against your catalog.</p>
          <div className="mt-auto pt-6">
            <Link href="/recalls/new" className={btn.hero}>
              Search recalls <ArrowUpRight size={16} aria-hidden />
            </Link>
          </div>
        </>
      )}
    </Hero>
  );
}

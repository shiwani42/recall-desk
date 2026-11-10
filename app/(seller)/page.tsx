import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import StatusBar from "@/components/StatusBar";
import { Badge, btn, Card, SEVERITY, Skeleton, Stat, fmtDate } from "@/components/ui";
import { getDb } from "@/lib/db";
import { catalogItems } from "@/lib/products";
import { ledgerTotals, recallSummaries } from "@/lib/recalls/queries";
import { recallWatch } from "@/lib/recalls/watch";

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recalls</h1>
          <p className="mt-1 text-sm text-muted">
            Every PayPal sale is itemized by SKU, so when a product is recalled you know exactly who has it.
          </p>
        </div>
        <Link href="/recalls/new" className={btn.primary}>New recall</Link>
      </div>
      <Suspense fallback={null}>
        <WatchBanner />
      </Suspense>
      <Suspense fallback={<Skeleton rows={4} />}>
        <DashboardContent />
      </Suspense>
    </div>
  );
}

async function DashboardContent() {
  await connection();
  const db = getDb();
  const totals = ledgerTotals(db);
  const recalls = recallSummaries(db);
  const open = recalls.filter((r) => r.recall.status === "active");
  const outstanding = recalls.reduce((s, r) => s + (r.cases - r.resolved), 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Sales tracked" value={totals.sales} hint="PayPal captures in ledger" />
        <Stat label="Units tracked" value={totals.units} hint={`across ${totals.skus} SKUs`} />
        <Stat label="Active recalls" value={open.length} />
        <Stat label="Units outstanding" value={outstanding} hint="affected, not yet resolved" />
      </div>

      {recalls.length === 0 ? (
        <Card className="p-10 text-center">
          <p className="font-medium">No recalls yet</p>
          <p className="mt-1 text-sm text-muted">
            {totals.sales === 0 ? (
              <>The sales ledger is empty. Run <code className="font-mono">npm run db:seed</code> to create sandbox sales.</>
            ) : (
              <>When a product you sold is recalled, start here. Recall Desk finds every affected buyer.</>
            )}
          </p>
          <Link href="/recalls/new" className={`${btn.primary} mt-4`}>Start a recall</Link>
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {recalls.map(({ recall, skus, cases, units, notified, resolved, failed, processing, shipping, waiting, identified }) => (
            <Link key={recall.id} href={`/recalls/${recall.id}`} className="grid gap-3 p-4 hover:bg-background md:grid-cols-[1fr_220px] md:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">{recall.id}</span>
                  <Badge tone={SEVERITY[recall.severity].tone}>{SEVERITY[recall.severity].label}</Badge>
                  {failed > 0 && <Badge tone="danger">{failed} failed</Badge>}
                </div>
                <p className="mt-1 truncate font-medium">{recall.title}</p>
                <p className="text-sm text-muted">
                  {skus} · {units} units · {cases} buyers · {notified} notified · opened {fmtDate(recall.createdAt)}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-muted">
                  <span className="font-medium tabular-nums text-foreground">{resolved}</span> of {cases} resolved
                </p>
                <StatusBar counts={{ resolved, processing, remedy_selected: shipping, notified: waiting, identified, failed }} />
              </div>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

// Proactive: government recalls that match products this seller sold.
async function WatchBanner() {
  await connection();
  const { hits } = await recallWatch(getDb(), catalogItems());
  if (hits.length === 0) return null;
  const units = hits.reduce((s, h) => s + h.matches.reduce((u, m) => u + m.units, 0), 0);
  return (
    <Link href="/recalls/new" className="flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 hover:opacity-90">
      <span className="grid h-8 w-8 place-items-center rounded-full bg-danger text-sm font-bold text-white">!</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-danger">
          {hits.length} government recall{hits.length === 1 ? "" : "s"} may affect products you sold
        </span>
        <span className="block truncate text-sm">
          {hits[0].notice.title} · {units} unit{units === 1 ? "" : "s"} in your sales ledger
        </span>
      </span>
      <span className="text-sm font-medium text-danger">Review →</span>
    </Link>
  );
}

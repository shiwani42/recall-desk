import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import CaseActions from "@/components/CaseActions";
import MarketCheck from "@/components/MarketCheck";
import RecallToolbar from "@/components/RecallToolbar";
import StatusBar, { type StatusCounts } from "@/components/StatusBar";
import { Badge, Card, Hero, REMEDY_LABEL, SEVERITY, STATUS, Skeleton, fmtDate } from "@/components/ui";
import { getDb } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buyerLink } from "@/lib/recalls/notify";
import { recallDetail } from "@/lib/recalls/queries";

export default function RecallPage({ params }: PageProps<"/recalls/[id]">) {
  return (
    <Suspense fallback={<Skeleton rows={8} />}>
      <RecallContent params={params} />
    </Suspense>
  );
}

async function RecallContent({ params }: { params: PageProps<"/recalls/[id]">["params"] }) {
  const { id } = await params;
  await connection(); // DB reads are synchronous: opt into per-request rendering
  const data = recallDetail(getDb(), id);
  if (!data) notFound();
  const { recall, skus, cases } = data;

  const h = await headers();
  const base = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;

  const units = cases.reduce((s, r) => s + r.c.quantity, 0);
  const resolved = cases.filter((r) => r.c.status === "resolved").length;
  const toNotify = cases.filter((r) => r.c.status === "identified" && r.sale.buyerEmail).length;
  const refundsPending = cases.filter((r) => r.c.recommendedRemedy === "refund" && ["identified", "notified"].includes(r.c.status)).length;
  const refunded = cases.reduce((s, r) => s + (["resolved", "processing"].includes(r.c.status) && r.c.chosenRemedy === "refund" ? r.c.refundAmountCents : 0), 0);
  const window = recall.soldFrom || recall.soldTo
    ? `sold ${recall.soldFrom ? fmtDate(recall.soldFrom) : "any time"} – ${recall.soldTo ? fmtDate(recall.soldTo) : "now"}`
    : "all sales";

  return (
    <div className="space-y-4">
      <Link href="/" className="inline-block pt-2 text-sm text-muted transition-colors duration-150 hover:text-foreground">← Recalls</Link>
      <Hero className="p-7">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={SEVERITY[recall.severity].tone}>{SEVERITY[recall.severity].label}</Badge>
          {skus.map((s) => (
            <span key={s} className="rounded-full border border-hero-line px-2.5 py-0.5 text-xs font-medium">{s}</span>
          ))}
          <span className="font-mono text-xs text-hero-muted">{recall.id}</span>
        </div>
        <h1 className="mt-4 max-w-3xl text-[32px] font-medium leading-tight tracking-tight">{recall.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-hero-muted">
          {recall.hazard}
          {recall.instructions && <> <span className="text-hero-fg">{recall.instructions}</span></>}
        </p>
        <p className="mt-1 text-xs text-hero-muted">
          Offers {recall.remedies.map((r) => REMEDY_LABEL[r]).join(" / ")}
          {recall.replacementStock !== null && ` · ${recall.replacementStock} replacement units`} · {window}
          {recall.sourceUrl && <> · <a href={recall.sourceUrl} className="underline" target="_blank" rel="noreferrer">official notice<span className="sr-only"> (opens in a new tab)</span></a></>}
        </p>
        <dl className="mt-8 grid grid-cols-2 gap-6 border-t border-hero-line pt-6 md:grid-cols-4">
          <HeroStat label="Affected buyers" value={cases.length} hint={`${units} units`} />
          <HeroStat label="Notified" value={cases.filter((r) => r.c.notifiedAt).length} />
          <HeroStat
            label="Resolved"
            value={`${cases.length ? Math.round((resolved / cases.length) * 100) : 0}%`}
            hint={`${resolved} of ${cases.length} buyers`}
          />
          {recall.remedies.includes("refund") ? (
            <HeroStat label="Refunded" value={refunded ? formatMoney(refunded) : "—"} hint="via PayPal, incl. in flight" />
          ) : (
            <HeroStat
              label="Shipped"
              value={`${resolved}/${cases.length}`}
              hint={`${cases.filter((r) => r.c.status === "remedy_selected").length} awaiting shipment`}
            />
          )}
        </dl>
      </Hero>

      {cases.length > 0 && (
        <Card className="p-6">
          <p className="mb-3 text-sm font-medium">Where every affected buyer stands</p>
          <StatusBar
            variant="tall"
            counts={cases.reduce<StatusCounts>((acc, r) => ({ ...acc, [r.c.status]: (acc[r.c.status] ?? 0) + 1 }), {})}
          />
        </Card>
      )}

      <Suspense fallback={null}>
        <MarketCheck skus={skus} />
      </Suspense>

      <RecallToolbar recallId={recall.id} toNotify={toNotify} refundsPending={refundsPending} inFlight={cases.filter((r) => r.c.status === "processing").length} />

      {cases.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No sales of these SKUs in the ledger{recall.soldFrom || recall.soldTo ? " for this date window" : ""}.</Card>
      ) : (
        <>
        <div className="space-y-3 xl:hidden">
          {cases.map(({ c, sale, item }) => (
            <Card key={c.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{sale.buyerName ?? "Unknown buyer"}</p>
                  <p className="truncate text-xs text-muted">{sale.buyerEmail ?? "no email"} · {[sale.shipAddress?.city, sale.shipAddress?.state].filter(Boolean).join(", ")}</p>
                </div>
                <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{c.quantity}× {item.name} <span className="text-xs text-muted">· {fmtDate(sale.capturedAt)}</span></span>
                <span className="tabular-nums">{formatMoney(c.refundAmountCents, sale.currency)}</span>
              </div>
              <p className="text-xs text-muted">
                <span className="font-medium text-foreground">{REMEDY_LABEL[c.recommendedRemedy]}</span> recommended · {c.recommendationReason}
              </p>
              {c.resolution?.note && <p className="text-xs text-muted">{c.resolution.note}</p>}
              {c.resolution?.error && <p className="text-xs text-danger">{c.resolution.error}</p>}
              <CaseActions
                caseId={c.id}
                status={c.status}
                chosen={c.chosenRemedy}
                recommended={c.recommendedRemedy}
                remedies={recall.remedies}
                buyerUrl={buyerLink(base, c.buyerToken)}
                amount={formatMoney(c.refundAmountCents, sale.currency)}
              />
            </Card>
          ))}
        </div>
        <Card className="hidden overflow-x-auto xl:block">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="sticky top-0 whitespace-nowrap border-b border-line bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="p-3 font-medium">Buyer</th>
                <th className="p-3 font-medium">Purchase</th>
                <th className="p-3 text-right font-medium">Amount</th>
                <th className="p-3 font-medium">Recommended fix</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {cases.map(({ c, sale, item }) => {
                const res = c.resolution;
                return (
                  <tr key={c.id} className="align-top">
                    <td className="p-3">
                      <p className="font-medium">{sale.buyerName ?? "Unknown buyer"}</p>
                      <p className="text-xs text-muted">{sale.buyerEmail ?? "no email"}</p>
                      <p className="text-xs text-muted">{[sale.shipAddress?.city, sale.shipAddress?.state].filter(Boolean).join(", ")}</p>
                    </td>
                    <td className="min-w-[200px] p-3">
                      <p>{c.quantity}× {item.name}</p>
                      <p className="text-xs text-muted">{fmtDate(sale.capturedAt)}</p>
                      {sale.source === "legacy" && <p className="text-xs text-warn">no PayPal capture</p>}
                    </td>
                    <td className="whitespace-nowrap p-3 text-right tabular-nums">{formatMoney(c.refundAmountCents, sale.currency)}</td>
                    <td className="min-w-[200px] max-w-[260px] p-3">
                      <p className="font-medium">
                        {REMEDY_LABEL[c.recommendedRemedy]}
                        {c.recommendedRemedy === "refund" && <span className="font-normal text-muted"> · {c.refundRail === "payout" ? "PayPal payout" : "PayPal refund"}</span>}
                      </p>
                      <p className="line-clamp-2 text-xs text-muted" title={c.recommendationReason}>{c.recommendationReason}</p>
                    </td>
                    <td className="p-3">
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                      {c.chosenRemedy && <p className="mt-1 text-xs text-muted">chose {REMEDY_LABEL[c.chosenRemedy].toLowerCase()}</p>}
                      {res?.note && <p className="mt-1 max-w-[220px] text-xs text-muted">{res.note}</p>}
                      {res?.error && <p className="mt-1 max-w-[220px] text-xs text-danger">{res.error}</p>}
                      <div className="mt-1 font-mono text-[11px] leading-4 text-muted">
                        {sale.captureId && <p title="Original PayPal capture">cap {sale.captureId}</p>}
                        {res?.paypalRefundId && <p className="text-ok" title="PayPal refund">ref {res.paypalRefundId} · {res.paypalStatus}</p>}
                        {res?.paypalPayoutBatchId && <p className="text-ok" title="PayPal payout batch">payout {res.paypalPayoutBatchId} · {res.paypalStatus}</p>}
                      </div>
                    </td>
                    <td className="p-3">
                      <CaseActions
                        caseId={c.id}
                        status={c.status}
                        chosen={c.chosenRemedy}
                        recommended={c.recommendedRemedy}
                        remedies={recall.remedies}
                        buyerUrl={buyerLink(base, c.buyerToken)}
                        amount={formatMoney(c.refundAmountCents, sale.currency)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        </>
      )}
    </div>
  );
}

function HeroStat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-hero-muted">{label}</dt>
      <dd className="mt-2 text-[36px] font-light leading-none tracking-tight tabular-nums">{value}</dd>
      {hint && <dd className="mt-1.5 text-xs text-hero-muted">{hint}</dd>}
    </div>
  );
}

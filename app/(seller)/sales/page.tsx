import { desc } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import ImportButton from "@/components/ImportButton";
import { Badge, Card, Skeleton, fmtDate } from "@/components/ui";
import { getDb, t } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export default function SalesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sales ledger</h1>
        <p className="mt-1 text-sm text-muted">Every PayPal capture, itemized by SKU, with who bought it and where it shipped.</p>
      </div>
      <ImportButton />
      <Suspense fallback={<Skeleton rows={8} />}>
        <SalesTable />
      </Suspense>
    </div>
  );
}

const SOURCE = { checkout: "Storefront", seed: "Sandbox seed", paypal_import: "PayPal import", legacy: "Legacy (no capture)" } as const;

async function SalesTable() {
  await connection();
  const db = getDb();
  const rows = db.select().from(t.sales).orderBy(desc(t.sales.capturedAt)).all();
  const items = db.select().from(t.saleItems).all();
  const bySale = Map.groupBy(items, (i) => i.saleId);

  if (rows.length === 0) return <Card className="p-8 text-center text-sm text-muted">No sales yet.</Card>;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="p-3 font-medium">Date</th>
            <th className="p-3 font-medium">Buyer</th>
            <th className="p-3 font-medium">Items (SKU)</th>
            <th className="p-3 text-right font-medium">Total</th>
            <th className="p-3 font-medium">PayPal capture</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((s) => (
            <tr key={s.id} className="align-top">
              <td className="whitespace-nowrap p-3">{fmtDate(s.capturedAt)}</td>
              <td className="p-3">
                <p className="font-medium">{s.buyerName ?? "—"}</p>
                <p className="text-xs text-muted">{s.buyerEmail}</p>
                <p className="text-xs text-muted">{[s.shipAddress?.city, s.shipAddress?.state].filter(Boolean).join(", ")}</p>
              </td>
              <td className="p-3">
                {(bySale.get(s.id) ?? []).map((i) => (
                  <p key={i.id}>
                    {i.quantity}× <span className="font-mono text-xs">{i.sku}</span> <span className="text-muted">{i.name}</span>
                  </p>
                ))}
              </td>
              <td className="p-3 text-right tabular-nums">{formatMoney(s.totalCents, s.currency)}</td>
              <td className="p-3">
                <p className="font-mono text-xs">{s.captureId ?? "—"}</p>
                <Badge tone={s.source === "legacy" ? "warn" : "neutral"}>{SOURCE[s.source]}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";
import { importFromPayPalAction } from "@/app/recall-actions";
import { btn, input } from "@/components/ui";

type Result = Awaited<ReturnType<typeof importFromPayPalAction>>;

export default function ImportButton() {
  const [days, setDays] = useState(90);
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Result | null>(null);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="How far back to import" value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${input} !w-auto`} disabled={pending}>
          <option value={31}>Last 31 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
          <option value={1095}>Last 3 years</option>
        </select>
        <button className={btn.primary} disabled={pending} onClick={() => start(async () => setRes(await importFromPayPalAction(days)))}>
          {pending ? "Searching PayPal…" : "Import from PayPal"}
        </button>
      </div>
      {res && !res.ok && <p role="alert" data-testid="import-result" className="text-sm text-danger">{res.error}</p>}
      {res?.ok && (
        <div role="status" data-testid="import-result" className="rounded-2xl bg-surface p-4 text-sm">
          <p>
            <strong>{res.imported}</strong> new sale{res.imported === 1 ? "" : "s"} imported
            {res.newCases > 0 && <> · <strong className="text-danger">{res.newCases}</strong> newly affected by open recalls</>}
            <span className="text-muted"> · {res.scanned} PayPal transactions scanned</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            {res.alreadyInLedger} already in ledger · {res.skippedNoItems} without item details (can&apos;t be matched by SKU) · {res.skippedFullyRefunded} fully refunded ·{" "}
            {res.skippedOther} non-sale (fees, transfers, refunds)
          </p>
          {res.lastRefreshed && (
            <p className="mt-1 text-xs text-muted">
              PayPal&apos;s search data is current up to {new Date(res.lastRefreshed).toLocaleString("en-US")}. Newer sales appear after PayPal indexes them (up to a few hours).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

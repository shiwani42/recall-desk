"use client";

import { useState, useTransition } from "react";
import { applyRecommendedRefundsAction, notifyAction, rescanAction, syncRecallAction } from "@/app/recall-actions";
import { btn } from "@/components/ui";

export default function RecallToolbar({ recallId, toNotify, refundsPending, inFlight }: { recallId: string; toNotify: number; refundsPending: number; inFlight: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const run = (fn: () => Promise<{ text: string; error?: boolean }>) =>
    start(async () => {
      setMsg(null);
      try {
        setMsg(await fn());
      } catch (e) {
        setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
      }
    });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {toNotify > 0 && <button
          className={btn.primary}
          disabled={pending}
          onClick={() =>
            run(async () => {
              const r = await notifyAction(recallId);
              const how = r.sent ? `${r.sent} emailed` : r.logged ? `${r.logged} logged to outbox (no SMTP configured)` : "";
              return {
                text: `Notified ${r.notified} buyer${r.notified === 1 ? "" : "s"}${how ? `: ${how}` : ""}${r.failed ? ` · ${r.failed} failed to send (retry from Outbox)` : ""}${r.skippedNoEmail ? ` · ${r.skippedNoEmail} without email` : ""}.`,
                error: r.failed > 0,
              };
            })
          }
        >
          Notify {toNotify} buyer{toNotify === 1 ? "" : "s"}
        </button>}
        {refundsPending > 0 && <button
          className={toNotify > 0 ? btn.secondary : btn.primary}
          disabled={pending}
          title="Refund every outstanding case where a refund is the recommended fix"
          onClick={() =>
            run(async () => {
              const r = await applyRecommendedRefundsAction(recallId);
              return { text: `Refunded ${r.ok}${r.failed ? ` · ${r.failed} failed: ${r.errors[0]}` : ""}.`, error: r.failed > 0 };
            })
          }
        >
          Apply {refundsPending} recommended refund{refundsPending === 1 ? "" : "s"}
        </button>}
        <button
          className={btn.secondary}
          disabled={pending}
          title="Look for newly recorded sales of these SKUs"
          onClick={() =>
            run(async () => {
              const r = await rescanAction(recallId);
              return { text: r.newCases ? `Found ${r.newCases} new affected sale(s).` : "No new affected sales." };
            })
          }
        >
          Rescan sales
        </button>
        {inFlight > 0 && <button
          className={btn.secondary}
          disabled={pending}
          title="Ask PayPal for the latest status of refunds and payouts still in flight"
          onClick={() =>
            run(async () => {
              const r = await syncRecallAction(recallId);
              return {
                text: `Checked ${r.checked} with PayPal · ${r.changed} updated${r.errors.length ? ` · ${r.errors[0]}` : ""}.`,
                error: r.errors.length > 0,
              };
            })
          }
        >
          Sync {inFlight} with PayPal
        </button>}
      </div>
      <div aria-live="polite">
        {pending && <p className="text-sm text-muted">Working… (refunds go through PayPal one by one)</p>}
        {msg && <p className={`text-sm ${msg.error ? "text-danger" : "text-ok"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}

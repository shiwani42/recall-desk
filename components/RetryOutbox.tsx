"use client";

import { useState, useTransition } from "react";
import { retryOutboxAction } from "@/app/recall-actions";
import { btn } from "@/components/ui";

export default function RetryOutbox({ failed }: { failed: number }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (failed === 0 && !msg) return null;
  return (
    <div className="flex items-center gap-3">
      <button className={btn.secondary} disabled={pending || failed === 0} onClick={() => start(async () => {
        const r = await retryOutboxAction();
        setMsg(`${r.sent} sent · ${r.failed} still failing`);
      })}>
        {pending ? "Retrying…" : `Retry ${failed} failed`}
      </button>
      {msg && <span className="text-sm text-muted">{msg}</span>}
    </div>
  );
}

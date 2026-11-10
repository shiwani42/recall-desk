"use client";

import { Check, Link2, MoreHorizontal, Package, RotateCcw, Truck, Wrench } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { markShippedAction, resolveCaseAction } from "@/app/recall-actions";
import { btn, input } from "@/components/ui";
import type { CaseStatus, Remedy } from "@/lib/db/schema";

const LABEL: Record<Remedy, string> = { refund: "Refund", replace: "Send replacement", repair: "Send repair kit" };
const ICON = { refund: RotateCcw, replace: Package, repair: Wrench };

// One primary action per row: the recommended remedy (or "Mark shipped").
// Everything else lives in the "More" menu.
export default function CaseActions({
  caseId, status, chosen, recommended, remedies, buyerUrl, amount,
}: { caseId: number; status: CaseStatus; chosen: Remedy | null; recommended: Remedy; remedies: Remedy[]; buyerUrl: string; amount: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      setOpen(false);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Failed");
    });
  const run = (r: Remedy) => {
    if (r === "refund" && !confirm(`Send a ${amount} refund through PayPal now?`)) return;
    act(() => resolveCaseAction(caseId, r));
  };

  const awaitingShipment = status === "remedy_selected" && chosen !== "refund";
  const done = status === "resolved" || status === "processing";
  const others = remedies.filter((r) => r !== recommended);
  const PrimaryIcon = ICON[recommended];

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1">
        {awaitingShipment ? (
          <>
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking #" aria-label="Tracking number" className={`${input} !w-28 !py-1.5 text-xs`} />
            <button className={btn.primary + " !px-3 !py-1.5 text-xs"} disabled={pending} onClick={() => act(() => markShippedAction(caseId, tracking))}>
              <Truck size={14} aria-hidden /> Mark shipped
            </button>
          </>
        ) : done ? (
          <span className="flex items-center gap-1 text-xs text-ok"><Check size={14} aria-hidden /> Done</span>
        ) : (
          <button className={btn.primary + " !px-3 !py-1.5 text-xs"} disabled={pending} onClick={() => run(recommended)}>
            <PrimaryIcon size={14} aria-hidden />
            {pending ? "Working…" : recommended === "refund" ? `Refund ${amount}` : LABEL[recommended]}
          </button>
        )}
        <div className="relative" ref={menu}>
          <button
            className="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            title="More actions"
            onClick={() => setOpen((o) => !o)}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
              {!done && !awaitingShipment &&
                others.map((r) => {
                  const Icon = ICON[r];
                  return (
                    <button key={r} role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-background" onClick={() => run(r)}>
                      <Icon size={14} aria-hidden /> {r === "refund" ? `Refund ${amount} instead` : `${LABEL[r]} instead`}
                    </button>
                  );
                })}
              <button
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-background"
                onClick={async () => {
                  await navigator.clipboard.writeText(buyerUrl);
                  setCopied(true);
                  setOpen(false);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Link2 size={14} aria-hidden /> Copy buyer link
              </button>
            </div>
          )}
        </div>
      </div>
      {copied && <p className="text-xs text-ok" role="status">Buyer link copied</p>}
      {error && <p className="max-w-[240px] text-right text-xs text-danger">{error}</p>}
    </div>
  );
}

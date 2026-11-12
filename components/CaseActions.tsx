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
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Menu button pattern: focus the first item on open, Escape closes and returns focus.
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        setOpen(false);
        trigger.current?.focus();
      } else if (!menu.current?.contains(e.target as Node)) setOpen(false);
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
            <input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Tracking #" aria-label="Tracking number" autoComplete="off" spellCheck={false} className={`${input} !w-28 !py-1.5 sm:!text-xs`} />
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
            ref={trigger}
            type="button"
            className="grid h-10 w-10 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-background hover:text-foreground xl:h-8 xl:w-8"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={open}
            title="More actions"
            onClick={() => setOpen((o) => !o)}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {open && (
            <div
              role="menu"
              aria-label="More actions"
              onKeyDown={(e) => {
                if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                e.preventDefault();
                const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
                const i = items.indexOf(document.activeElement as HTMLElement);
                items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
              }}
              className="absolute right-0 top-full z-20 mt-1 w-52 rounded-lg border border-line bg-surface p-1 text-sm shadow-lg">
              {!done && !awaitingShipment &&
                others.map((r) => {
                  const Icon = ICON[r];
                  return (
                    <button key={r} type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-background focus-visible:bg-background focus-visible:outline-none" onClick={() => run(r)}>
                      <Icon size={14} aria-hidden /> {r === "refund" ? `Refund ${amount} instead` : `${LABEL[r]} instead`}
                    </button>
                  );
                })}
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-background focus-visible:bg-background focus-visible:outline-none"
                onClick={async () => {
                  setOpen(false);
                  trigger.current?.focus();
                  try {
                    await navigator.clipboard.writeText(buyerUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  } catch {
                    setError("Couldn't copy the link. Your browser blocked clipboard access.");
                  }
                }}
              >
                <Link2 size={14} aria-hidden /> Copy buyer link
              </button>
            </div>
          )}
        </div>
      </div>
      {copied && <p className="text-xs text-ok" role="status">Buyer link copied</p>}
      {error && <p role="alert" className="max-w-[240px] text-right text-xs text-danger">{error}</p>}
    </div>
  );
}

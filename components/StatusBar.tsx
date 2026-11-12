import type { CaseStatus } from "@/lib/db/schema";

// Segmented bar: one whole (all cases of a recall) split by status.
// Order runs done → in progress → pending → failed. Thin (8px, no text) for list rows;
// tall (28px, counts inside, legend) for the recall page. Every part is focusable and
// names its status, count and share; the cases table below is the table view.
const PARTS: { status: CaseStatus; label: string; fill: string; ink: "light" | "dark" }[] = [
  { status: "resolved", label: "Resolved", fill: "var(--st-resolved)", ink: "light" },
  { status: "processing", label: "Money in flight", fill: "var(--st-flight)", ink: "light" },
  { status: "remedy_selected", label: "Awaiting shipment", fill: "var(--st-ship)", ink: "dark" },
  { status: "notified", label: "Notified, no reply yet", fill: "var(--st-notified)", ink: "dark" },
  { status: "identified", label: "Not yet notified", fill: "var(--st-identified)", ink: "dark" },
  { status: "failed", label: "Failed", fill: "var(--st-failed)", ink: "light" },
];

export type StatusCounts = Partial<Record<CaseStatus, number>>;

export default function StatusBar({ counts, variant = "thin" }: { counts: StatusCounts; variant?: "thin" | "tall" }) {
  const total = PARTS.reduce((s, p) => s + (counts[p.status] ?? 0), 0);
  if (total === 0) return null;
  const parts = PARTS.filter((p) => (counts[p.status] ?? 0) > 0);
  const pct = (n: number) => Math.round((n / total) * 100);
  const summary = parts.map((p) => `${p.label}: ${counts[p.status]}`).join(", ");
  const tall = variant === "tall";

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={`Case status, ${total} total. ${summary}.`}
        className={`flex w-full gap-[2px] ${tall ? "h-7" : "h-2 overflow-hidden rounded-full"}`}
      >
        {parts.map((p) => {
          const n = counts[p.status]!;
          const tip = `${p.label}: ${n} of ${total} (${pct(n)}%)`;
          return (
            <div
              key={p.status}
              tabIndex={tall ? 0 : -1}
              aria-label={tip}
              className={`group relative min-w-[6px] outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface ${tall ? "rounded-[4px]" : ""}`}
              style={{ flexGrow: n, flexBasis: 0, background: p.fill }}
            >
              {tall && pct(n) >= 9 && (
                <span className={`absolute inset-y-0 left-2 flex items-center text-xs font-semibold tabular-nums ${p.ink === "light" ? "text-white" : "text-zinc-900"}`}>
                  {n}
                </span>
              )}
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground shadow-sm group-hover:block group-focus-visible:block"
              >
                {tip}
              </span>
            </div>
          );
        })}
      </div>
      {tall && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {parts.map((p) => (
            <li key={p.status} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: p.fill }} />
              {p.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

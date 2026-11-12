import type { CaseStatus, Remedy, Severity } from "@/lib/db/schema";

// Press feedback: a quick, subtle scale-down on :active (skipped under reduced motion and on
// disabled buttons); colour and opacity changes ease over 150ms.
export const press =
  "transition-[scale,background-color,border-color,color,opacity] duration-150 ease-snappy motion-safe:not-disabled:active:scale-[0.97]";

export const btn = {
  primary:
    `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed ${press}`,
  secondary:
    `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed ${press}`,
  small:
    `inline-flex items-center justify-center rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-50 disabled:cursor-not-allowed ${press}`,
  /** The call to action on a Hero card. */
  hero: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-hero-btn px-5 py-2.5 text-sm font-semibold text-hero-btn-fg hover:opacity-90 ${press}`,
};

export const input =
  "w-full rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-foreground outline-none transition-[border-color,box-shadow] duration-150 focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm";

const tone = {
  neutral: "bg-surface-2 text-muted border-line",
  accent: "bg-accent-soft text-foreground border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};
export type Tone = keyof typeof tone;

export function Badge({ children, tone: t = "neutral", title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone[t]}`}>
      {children}
    </span>
  );
}

export const STATUS: Record<CaseStatus, { label: string; tone: Tone }> = {
  identified: { label: "Identified", tone: "neutral" },
  notified: { label: "Notified", tone: "accent" },
  remedy_selected: { label: "Awaiting shipment", tone: "warn" },
  processing: { label: "Money in flight", tone: "accent" },
  resolved: { label: "Resolved", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
};

export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  high: { label: "High severity", tone: "danger" },
  medium: { label: "Medium severity", tone: "warn" },
  low: { label: "Low severity", tone: "neutral" },
};

export const REMEDY_LABEL: Record<Remedy, string> = { refund: "Refund", replace: "Replace", repair: "Repair" };

/** A bento panel: white on the warm canvas, 24px corners. */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-panel border border-transparent bg-surface dark:border-line ${className}`}>{children}</section>;
}

/** The one dark "this needs you" card on a screen (lime in dark mode). */
export function Hero({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return <section className={`rounded-panel bg-hero text-hero-fg ${className}`}>{children}</section>;
}

/** Big light number with a small label; an optional sparkline of real values sits under it. */
export function Stat({ label, value, hint, spark }: { label: string; value: React.ReactNode; hint?: React.ReactNode; spark?: number[] }) {
  return (
    <div className="flex flex-col rounded-panel border border-transparent bg-surface p-5 dark:border-line">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-3 text-[40px] font-light leading-none tracking-tight tabular-nums">{value}</p>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
      {spark && spark.length > 1 && <Spark values={spark} className="mt-4" />}
    </div>
  );
}

/** Tiny bar sparkline, last bar highlighted. Decorative: the number above carries the meaning. */
export function Spark({ values, className = "" }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div aria-hidden className={`flex h-10 items-end gap-[3px] ${className}`}>
      {values.map((v, i) => (
        <span
          key={i}
          className={`flex-1 rounded-full ${i === values.length - 1 ? "bg-accent" : "bg-accent-soft"}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 rounded-2xl bg-surface motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

export const fmtDate = (d: Date | number) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

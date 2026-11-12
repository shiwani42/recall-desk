import type { CaseStatus, Remedy, Severity } from "@/lib/db/schema";

export const btn = {
  primary:
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed",
  small:
    "inline-flex items-center justify-center rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium hover:bg-background disabled:opacity-50 disabled:cursor-not-allowed",
};

export const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-foreground outline-none focus:border-accent sm:text-sm focus:ring-2 focus:ring-accent/20";

const tone = {
  neutral: "bg-background text-muted border-line",
  accent: "bg-accent-soft text-accent border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  danger: "bg-danger-soft text-danger border-transparent",
};
export type Tone = keyof typeof tone;

export function Badge({ children, tone: t = "neutral", title }: { children: React.ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${tone[t]}`}>
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

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-12 rounded-lg bg-surface motion-safe:animate-pulse" />
      ))}
    </div>
  );
}

export const fmtDate = (d: Date | number) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

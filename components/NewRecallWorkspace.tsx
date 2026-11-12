"use client";

import { useState, useTransition } from "react";
import { aiDraftAction, searchCpscAction } from "@/app/recall-actions";
import RecallForm from "@/components/RecallForm";
import { Badge, btn, Card, input } from "@/components/ui";
import type { Notice } from "@/lib/cpsc";
import { draftFromAi, draftFromCpsc, type Draft } from "@/lib/recalls/draft";
import type { Match } from "@/lib/recalls/matcher";

type SkuRow = { sku: string; name: string; units: number; buyers: number };
type Hit = { notice: Notice; matches: (Match & { units?: number; buyers?: number })[] };

export default function NewRecallWorkspace({
  skus, watch, watchError, scanned, aiOn,
}: { skus: SkuRow[]; watch: Hit[]; watchError?: string; scanned: number; aiOn: boolean }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tab, setTab] = useState<"watch" | "search" | "paste">("watch");

  const use = (d: Draft) => {
    setDraft(d);
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById("recall-form")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" }));
  };

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Start from an official notice</h2>
            <p className="text-sm text-muted">Pre-fill the recall and find affected SKUs automatically.</p>
          </div>
          <div className="flex rounded-full bg-surface-2 p-1 text-sm">
            {([["watch", `Recall watch${watch.length ? ` (${watch.length})` : ""}`], ["search", "Search CPSC"], ["paste", "Paste a notice"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)} className={`rounded-full px-4 py-1.5 transition-colors duration-150 ${tab === k ? "bg-accent text-on-accent" : "text-muted hover:text-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {tab === "watch" && (
          <div className="space-y-3">
            <p className="text-xs text-muted">
              {watchError ? `Couldn't reach the CPSC recall feed (${watchError}).` : `Checked ${scanned} US government (CPSC) recalls from the last 90 days against the products you've sold.`}
            </p>
            {watch.length === 0 && !watchError && <p className="text-sm">No recent government recalls match products you sold. 👍</p>}
            {watch.map((h) => <NoticeRow key={h.notice.id} hit={h} onUse={() => use(draftFromCpsc(h.notice, h.matches))} />)}
          </div>
        )}
        {tab === "search" && <CpscSearch onUse={use} />}
        {tab === "paste" && <PasteNotice aiOn={aiOn} onUse={use} />}
      </Card>

      <Card className="p-6" >
        <div id="recall-form" className="scroll-mt-4" />
        {draft && (
          <div className="mb-5 rounded-lg bg-accent-soft p-3 text-sm">
            <p className="font-medium text-accent">Pre-filled from {draft.source}</p>
            {draft.note && <p className="mt-1 text-xs text-muted">{draft.note}</p>}
          </div>
        )}
        <RecallForm key={draft?.key ?? "blank"} skus={skus} initial={draft?.initial} suggestions={draft?.suggestions} />
      </Card>
    </div>
  );
}

function NoticeRow({ hit: { notice, matches }, onUse }: { hit: Hit; onUse: () => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-line p-3">
      {notice.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={notice.imageUrl} alt="" className="h-14 w-14 rounded object-cover" onError={(e) => e.currentTarget.remove()} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={notice.severity === "high" ? "danger" : "warn"}>{notice.severity === "high" ? "High severity" : "Medium severity"}</Badge>
          <span className="text-xs text-muted">CPSC #{notice.id} · {notice.date}</span>
        </div>
        <a href={notice.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium hover:underline">{notice.title}</a>
        {matches.length > 0 ? (
          <ul className="mt-1 space-y-0.5 text-xs">
            {matches.map((m) => (
              <li key={m.sku}>
                <span className={m.confidence === "strong" ? "font-semibold text-danger" : "font-semibold text-warn"}>{m.sku}</span>
                {m.units !== undefined && <span className="text-muted"> · you sold {m.units} to {m.buyers} buyers</span>}
                <span className="text-muted"> · {m.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted">No catalog match. You can still pick SKUs manually.</p>
        )}
      </div>
      <button type="button" className={btn.secondary} onClick={onUse}>Use this notice</button>
    </div>
  );
}

function CpscSearch({ onUse }: { onUse: (d: Draft) => void }) {
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const [res, setRes] = useState<Awaited<ReturnType<typeof searchCpscAction>> | null>(null);
  return (
    <div className="space-y-3">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => setRes(await searchCpscAction(q))); }}>
        <input type="search" aria-label="Search CPSC recalls" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. space heater, DREO, charger…" className={input} />
        <button className={btn.primary} disabled={pending || q.trim().length < 2}>{pending ? "Searching…" : "Search"}</button>
      </form>
      {res && !res.ok && <p role="alert" className="text-sm text-danger">{res.error}</p>}
      {res?.ok && res.results.length === 0 && <p className="text-sm text-muted">No CPSC recalls found.</p>}
      {res?.ok && res.results.map((r) => <NoticeRow key={r.notice.id} hit={r} onUse={() => onUse(draftFromCpsc(r.notice, r.matches))} />)}
    </div>
  );
}

function PasteNotice({ aiOn, onUse }: { aiOn: boolean; onUse: (d: Draft) => void }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <textarea
        rows={6}
        aria-label="Recall notice text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!aiOn}
        placeholder="Paste a manufacturer's recall email, press release, or notice…"
        className={input}
      />
      {!aiOn && (
        <p className="text-xs text-muted">
          AI drafting is off. Add <code className="font-mono">ANTHROPIC_API_KEY</code> to <code className="font-mono">.env.local</code> and restart to have Claude read notices and match them to your SKUs.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button
        type="button"
        className={btn.primary}
        disabled={!aiOn || pending || text.trim().length < 40}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await aiDraftAction(text);
            if (r.ok) onUse(draftFromAi(r.draft));
            else setError(r.error);
          })
        }
      >
        {pending ? "Reading notice…" : "Draft recall with AI"}
      </button>
    </div>
  );
}

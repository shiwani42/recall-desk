"use client";

import { useActionState } from "react";
import { createRecallAction, type FormState } from "@/app/recall-actions";
import { btn, input } from "@/components/ui";
import type { RecallInitial, Suggestion } from "@/lib/recalls/draft";

type SkuRow = { sku: string; name: string; units: number; buyers: number };

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <label className="block space-y-1.5">
    <span className="text-sm font-medium">{label}</span>
    {children}
    {hint && <span className="block text-xs text-muted">{hint}</span>}
  </label>
);

export default function RecallForm({ skus, initial, suggestions = {} }: { skus: SkuRow[]; initial?: RecallInitial; suggestions?: Record<string, Suggestion> }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createRecallAction, undefined);
  const v = (state?.values ?? initial ?? {}) as Record<string, string | string[]>;
  const has = (k: string, val: string) => (Array.isArray(v[k]) ? (v[k] as string[]).includes(val) : false);
  const fresh = !state?.values && !initial;

  return (
    <form action={action} autoComplete="off" className="space-y-6">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Affected SKUs</legend>
        <p className="text-xs text-muted">Units sold and buyers come from your PayPal sales ledger.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {skus.map((s) => (
            <label key={s.sku} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="skus" value={s.sku} defaultChecked={has("skus", s.sku)} className="mt-1 accent-[var(--accent)]" />
              <span className="min-w-0">
                <span className="block font-mono text-xs text-muted">{s.sku}</span>
                <span className="block truncate text-sm font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.units} units · {s.buyers} buyers</span>
                {suggestions[s.sku] && (
                  <span
                    title={suggestions[s.sku].reason}
                    className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${suggestions[s.sku].confidence === "strong" ? "bg-danger-soft text-danger" : "bg-warn-soft text-warn"}`}
                  >
                    {suggestions[s.sku].confidence === "strong" ? "Named in recall" : "Possible match: confirm"}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
        <Field label="Recall title">
          <input name="title" required className={input} defaultValue={(v.title as string) ?? ""} placeholder="Space heater HTR-200: fire hazard" />
        </Field>
        <Field label="Severity">
          <select name="severity" className={input} defaultValue={(v.severity as string) ?? "high"}>
            <option value="high">High: injury or fire risk</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </Field>
      </div>

      <Field label="Hazard" hint="Shown to buyers. Say plainly what can go wrong.">
        <textarea name="hazard" required rows={2} className={input} defaultValue={(v.hazard as string) ?? ""} placeholder="The power cord can overheat at the plug, posing fire and burn hazards." />
      </Field>
      <Field label="What buyers should do right now">
        <input name="instructions" className={input} defaultValue={(v.instructions as string) ?? ""} placeholder="Stop using the heater immediately and unplug it." />
      </Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Remedies offered</legend>
        <div className="flex flex-wrap gap-2">
          {(["refund", "replace", "repair"] as const).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input type="checkbox" name="remedies" value={r} defaultChecked={fresh ? r !== "repair" : has("remedies", r)} className="accent-[var(--accent)]" />
              {r === "refund" ? "Refund" : r === "replace" ? "Replacement" : "Repair kit"}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Recall Desk recommends the best one per buyer. Buyers can pick any you offer.</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Replacement stock" hint="Blank = unlimited">
          <input name="replacementStock" type="number" min={0} className={input} defaultValue={(v.replacementStock as string) ?? ""} />
        </Field>
        <Field label="Sold from" hint="Optional: affected batch window">
          <input name="soldFrom" type="date" className={input} defaultValue={(v.soldFrom as string) ?? ""} />
        </Field>
        <Field label="Sold to">
          <input name="soldTo" type="date" className={input} defaultValue={((v.soldTo as string) ?? "").slice(0, 10)} />
        </Field>
      </div>

      <Field label="Official notice URL" hint="Optional, e.g. the CPSC or manufacturer recall page">
        <input name="sourceUrl" type="url" className={input} defaultValue={(v.sourceUrl as string) ?? ""} placeholder="https://www.cpsc.gov/Recalls/…" />
      </Field>

      {state?.error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}

      <button type="submit" disabled={pending} className={btn.primary}>
        {pending ? "Finding affected buyers…" : "Create recall & find buyers"}
      </button>
    </form>
  );
}

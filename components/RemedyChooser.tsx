"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { buyerChooseAction } from "@/app/recall-actions";
import { btn } from "@/components/ui";
import type { Remedy } from "@/lib/db/schema";

export type RemedyOption = { remedy: Remedy; title: string; detail: string; disabled?: string };

export default function RemedyChooser({ token, options, recommended }: { token: string; options: RemedyOption[]; recommended: Remedy }) {
  const firstEnabled = options.find((o) => !o.disabled)?.remedy;
  const [choice, setChoice] = useState<Remedy | undefined>(options.find((o) => o.remedy === recommended && !o.disabled)?.remedy ?? firstEnabled);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!choice) return;
        start(async () => {
          setError(null);
          const r = await buyerChooseAction(token, choice);
          if (!r.ok) setError(r.error);
        });
      }}
    >
      <fieldset className="space-y-3">
      <legend className="sr-only">Choose your remedy</legend>
      {options.map((o) => (
        <label
          key={o.remedy}
          className={`flex gap-3 rounded-2xl border p-5 transition-[scale,background-color,border-color,box-shadow] duration-200 ease-snappy ${o.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-muted/50 hover:bg-background motion-safe:active:scale-[0.99]"} border-line has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40`}
        >
          <input
            type="radio"
            name="remedy"
            value={o.remedy}
            disabled={Boolean(o.disabled) || pending}
            checked={choice === o.remedy}
            onChange={() => setChoice(o.remedy)}
            className="mt-1 accent-[var(--accent)] focus-visible:outline-none"
          />
          <span>
            <span className="flex items-center gap-2 font-medium">
              {o.title}
              {o.remedy === recommended && !o.disabled && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-on-accent">Recommended</span>
              )}
            </span>
            <span className="block text-sm text-muted">{o.disabled ?? o.detail}</span>
          </span>
        </label>
      ))}
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={!choice || pending} className={`${btn.primary} w-full py-2.5`}>
        {pending && <Loader2 size={16} aria-hidden className="motion-safe:animate-spin" />}
        {pending ? "Processing…" : "Confirm my choice"}
      </button>
    </form>
  );
}

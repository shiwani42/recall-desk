"use client";

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
      {options.map((o) => (
        <label
          key={o.remedy}
          className={`flex gap-3 rounded-xl border p-4 ${o.disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} border-line has-[:checked]:border-accent has-[:checked]:bg-accent-soft`}
        >
          <input
            type="radio"
            name="remedy"
            value={o.remedy}
            disabled={Boolean(o.disabled) || pending}
            checked={choice === o.remedy}
            onChange={() => setChoice(o.remedy)}
            className="mt-1 accent-[var(--accent)]"
          />
          <span>
            <span className="flex items-center gap-2 font-medium">
              {o.title}
              {o.remedy === recommended && !o.disabled && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-white">Recommended</span>
              )}
            </span>
            <span className="block text-sm text-muted">{o.disabled ?? o.detail}</span>
          </span>
        </label>
      ))}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={!choice || pending} className={`${btn.primary} w-full py-2.5`}>
        {pending ? "Processing…" : "Confirm my choice"}
      </button>
    </form>
  );
}

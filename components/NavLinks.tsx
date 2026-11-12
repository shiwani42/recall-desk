"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Recalls", match: (p: string) => p === "/" || p.startsWith("/recalls") },
  { href: "/sales", label: "Sales ledger", match: (p: string) => p.startsWith("/sales") },
  { href: "/analytics", label: "Analytics", match: (p: string) => p.startsWith("/analytics") },
  { href: "/outbox", label: "Outbox", match: (p: string) => p.startsWith("/outbox") },
];

// Active state needs the URL (request data), so the layout wraps this in <Suspense>
// with <NavList /> (no highlight) as the prerendered fallback.
export default function NavLinks() {
  return <NavList path={usePathname()} />;
}

export function NavList({ path = "" }: { path?: string }) {
  return (
    // `relative` matters on phones: this nav sits in a horizontally scrolling wrapper, and the Storefront
    // link's .sr-only span is absolutely positioned. Without a positioned ancestor inside the wrapper it
    // escapes the wrapper's clipping and makes the whole page scroll sideways (422px in a 390px viewport).
    <nav className="relative flex gap-1 whitespace-nowrap rounded-full bg-surface-2 p-1 text-sm" aria-label="Main">
      {NAV.map((n) => {
        const active = n.match(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-2 transition-colors duration-150 ${active ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-surface hover:text-foreground"}`}
          >
            {n.label}
          </Link>
        );
      })}
      <Link href="/store" target="_blank" className="flex items-center gap-1 rounded-full px-4 py-2 text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground">
        Storefront <ExternalLink size={13} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </Link>
    </nav>
  );
}

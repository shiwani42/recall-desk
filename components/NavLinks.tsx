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
    <nav className="flex gap-1 whitespace-nowrap text-sm" aria-label="Main">
      {NAV.map((n) => {
        const active = n.match(path);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 transition-colors duration-150 ${active ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-background hover:text-foreground"}`}
          >
            {n.label}
          </Link>
        );
      })}
      <Link href="/store" target="_blank" className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground">
        Storefront <ExternalLink size={13} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </Link>
    </nav>
  );
}

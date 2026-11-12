import Link from "next/link";
import { Suspense } from "react";
import NavLinks, { NavList } from "@/components/NavLinks";

export default function SellerLayout({ children }: { children: React.ReactNode }) {
  const sandbox = process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT !== "production";
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      <header className="mx-auto w-full max-w-6xl px-4 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel bg-surface p-2 sm:flex-nowrap sm:rounded-full dark:border dark:border-line">
          <Link href="/" className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-3 font-semibold tracking-tight">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-hero text-sm font-bold text-lime dark:text-hero-fg" aria-hidden>R</span>
            Recall Desk
          </Link>
          {sandbox && (
            <span className="ml-auto rounded-full bg-warn-soft px-3 py-1 text-xs font-medium text-warn sm:order-last">PayPal sandbox</span>
          )}
          <div className="-mx-2 w-[calc(100%+1rem)] overflow-x-auto px-2 sm:mx-auto sm:w-auto sm:overflow-visible sm:px-0">
            <Suspense fallback={<NavList />}>
              <NavLinks />
            </Suspense>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}

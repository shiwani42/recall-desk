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
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:flex-nowrap">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-sm text-on-accent" aria-hidden>R</span>
            Recall Desk
          </Link>
          {sandbox && (
            <span className="ml-auto rounded bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn sm:order-last">PayPal sandbox</span>
          )}
          <div className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
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

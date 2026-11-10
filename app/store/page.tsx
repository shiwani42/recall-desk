import { connection } from "next/server";
import { Suspense } from "react";
import PayPalCheckout from "@/components/PayPalCheckout";
import PayPalProviders from "@/components/PayPalProviders";
import { Skeleton } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { listProducts } from "@/lib/products";

export const metadata = { title: "Demo storefront" };

// A demo shop. Every PayPal purchase here lands in the seller's SKU-level sales ledger.
export default function StorePage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <header className="mb-8">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Demo storefront</p>
        <h1 className="text-2xl font-semibold tracking-tight">Small Seller Co.</h1>
        <p className="mt-1 text-sm text-muted">Pay with your PayPal sandbox buyer account. Each purchase is recorded by SKU in Recall Desk.</p>
      </header>
      <Suspense fallback={<Skeleton rows={3} />}>
        <Products />
      </Suspense>
    </main>
  );
}

async function Products() {
  await connection();
  const products = listProducts();
  if (products.length === 0) return <p className="text-sm text-muted">No products. Run <code className="font-mono">npm run db:seed</code>.</p>;
  // The provider lives inside the streamed boundary so it hydrates together with the
  // buttons. In the static shell it hydrated first, loaded the SDK, and the buttons'
  // first client render then mismatched the server HTML (React #418, prod builds only).
  return (
    <PayPalProviders>
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {products.map((p) => (
        <article key={p.sku} className="flex flex-col rounded-xl border border-line bg-surface p-5">
          <p className="font-mono text-xs text-muted">{p.sku}</p>
          <h2 className="mt-1 font-semibold">{p.name}</h2>
          <p className="mb-3 text-sm text-muted">{p.description}</p>
          <p className="mb-4 text-lg font-semibold">{formatMoney(p.unitPriceCents, p.currency)}</p>
          <div className="mt-auto">
            <PayPalCheckout sku={p.sku} />
          </div>
        </article>
      ))}
    </div>
    </PayPalProviders>
  );
}

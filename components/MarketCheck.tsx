import { inArray } from "drizzle-orm";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui";
import { channel3Enabled, marketCheck, type Listing } from "@/lib/channel3";
import { getDb, t } from "@/lib/db";

// Server component: what the wider market says about a recalled product, via Channel3.
//  - still on sale: the recalled model listed in stock at other retailers (worth reporting)
//  - safe alternatives: in-stock products of the same type from other brands, near the same price
// Renders nothing when Channel3 isn't configured. Wrap in <Suspense>: it calls an outside API.
export default async function MarketCheck({ skus }: { skus: string[] }) {
  if (!channel3Enabled()) return null;
  const products = getDb().select().from(t.products).where(inArray(t.products.sku, skus.slice(0, 2))).all();
  const checks = await Promise.all(products.map(async (p) => ({ p, r: await marketCheck(p) })));

  return (
    <Card className="space-y-5 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Market check</p>
        <p className="text-xs text-muted">Live retailer data via Channel3</p>
      </div>
      {checks.map(({ p, r }) =>
        !r.enabled ? null : (
          <div key={p.sku} className="space-y-4">
            {r.error && r.onSale.length === 0 && r.alternatives.length === 0 ? (
              <p className="text-sm text-muted">Couldn&apos;t reach Channel3 just now ({r.error}).</p>
            ) : (
              <>
                <div>
                  {r.onSale.length > 0 ? (
                    <>
                      <p className="flex items-center gap-2 text-sm font-medium text-warn">
                        <AlertTriangle size={16} aria-hidden />
                        {p.brand} {p.model} is still listed in stock at {countRetailers(r.onSale)} retailer{countRetailers(r.onSale) === 1 ? "" : "s"}
                      </p>
                      <ul className="mt-2 space-y-1 text-sm">
                        {r.onSale.slice(0, 4).flatMap((l) =>
                          l.retailers.slice(0, 2).map((o) => (
                            <li key={`${l.id}-${o.domain}`} className="flex items-baseline justify-between gap-3">
                              <a href={o.url} target="_blank" rel="noreferrer" className="truncate hover:underline">
                                {o.domain} <span className="text-muted">· {l.title}</span>
                              </a>
                              <span className="shrink-0 tabular-nums text-muted">${o.price.toFixed(2)}</span>
                            </li>
                          )),
                        )}
                      </ul>
                      <p className="mt-2 text-xs text-muted">
                        A recalled product still on sale can be reported to the CPSC at{" "}
                        <a href="https://www.saferproducts.gov/" target="_blank" rel="noreferrer" className="underline">SaferProducts.gov</a>.
                      </p>
                    </>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-ok">
                      <CheckCircle2 size={16} aria-hidden />
                      {p.model ? `${p.brand ?? ""} ${p.model}`.trim() : p.name} isn&apos;t listed in stock at any retailer Channel3 tracks.
                    </p>
                  )}
                </div>
                {r.alternatives.length > 0 && (
                  <div>
                    <p className="text-sm font-medium">Safe alternatives to suggest to refunded buyers</p>
                    <p className="text-xs text-muted">Same kind of product, other brands, in stock near ${(p.unitPriceCents / 100).toFixed(2)}. Also shown on the buyer&apos;s recall page.</p>
                    <Alternatives items={r.alternatives} />
                  </div>
                )}
              </>
            )}
          </div>
        ),
      )}
    </Card>
  );
}

const countRetailers = (ls: Listing[]) => new Set(ls.flatMap((l) => l.retailers.map((r) => r.domain))).size;

export function Alternatives({ items }: { items: Listing[] }) {
  return (
    <ul className="mt-3 grid gap-3 sm:grid-cols-3">
      {items.map((l) => (
        <li key={l.id}>
          <a
            href={l.retailers[0].url}
            target="_blank"
            rel="noreferrer"
            className="group flex h-full flex-col rounded-lg border border-line p-3 transition-colors duration-150 hover:border-accent"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- retailer images from many hosts */}
            <img src={l.image!} alt="" className="mb-2 h-28 w-full rounded-md bg-white object-contain" loading="lazy" />
            <span className="line-clamp-2 text-sm font-medium">{l.title}</span>
            <span className="mt-auto flex items-center justify-between pt-2 text-xs text-muted">
              <span>
                {l.brand && `${l.brand} · `}
                {l.retailers[0].domain}
              </span>
              <span className="flex items-center gap-1 tabular-nums text-foreground">
                ${l.retailers[0].price.toFixed(2)} <ExternalLink size={12} aria-hidden />
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

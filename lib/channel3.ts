// Channel3 (https://trychannel3.com): normalized product data across 25,000+ retailers.
// Recall Desk uses it for two recall questions the seller's own data can't answer:
//   1. Is the recalled product still for sale elsewhere, and where? (search by brand + model)
//   2. What safe, in-stock alternative can we point a refunded buyer to? (search by product type,
//      other brands only, near the original price)
// Enabled when CHANNEL3_API_KEY is set. Results are cached in memory for a few hours.

const API = process.env.CHANNEL3_BASE_URL ?? "https://api.trychannel3.com";
const TTL_MS = 6 * 3600e3;

export const channel3Enabled = () => Boolean(process.env.CHANNEL3_API_KEY);

type Offer = { availability: "InStock" | "OutOfStock"; domain: string; url: string; price: { price: number; currency: string; compare_at_price?: number | null } };
type Product = {
  id: string;
  title: string;
  brands?: { id: string; name: string }[];
  images?: { url: string; is_main_image?: boolean }[];
  offers?: Offer[];
  age?: string | null;
  category?: { name?: string } | null;
};

export type Listing = {
  id: string;
  title: string;
  brand: string;
  image: string | null;
  retailers: { domain: string; url: string; price: number }[];
  lowestPrice: number | null;
};

type Recalled = { name: string; brand: string | null; model: string | null; unitPriceCents: number };

const cache = new Map<string, { at: number; value: unknown }>();

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function search(body: Record<string, unknown>): Promise<Product[]> {
  const res = await fetch(`${API}/v1/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": process.env.CHANNEL3_API_KEY ?? "" },
    body: JSON.stringify({ config: { country: "US", currency: "USD" }, ...body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Channel3 ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { products?: Product[] };
  return json.products ?? [];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function toListing(p: Product): Listing {
  const inStock = (p.offers ?? []).filter((o) => o.availability === "InStock" && o.price?.price > 0);
  const retailers = inStock
    .map((o) => ({ domain: o.domain, url: o.url, price: o.price.price }))
    .sort((a, b) => a.price - b.price)
    .filter((o, i, all) => all.findIndex((x) => x.domain === o.domain) === i);
  const image = p.images?.find((i) => i.is_main_image)?.url ?? p.images?.[0]?.url ?? null;
  return { id: p.id, title: p.title, brand: p.brands?.[0]?.name ?? "", image, retailers, lowestPrice: retailers[0]?.price ?? null };
}

/** Listings of the recalled product itself that are still in stock somewhere. Matched on model number. */
export async function stillOnSale(product: Recalled): Promise<Listing[]> {
  if (!product.model) return [];
  const model = norm(product.model);
  return cached(`onsale:${product.brand}:${product.model}`, async () => {
    const products = await search({ query: `${product.brand ?? ""} ${product.model}`.trim(), limit: 20 });
    return products
      .filter((p) => norm(p.title).includes(model))
      .map(toListing)
      .filter((l) => l.retailers.length > 0);
  });
}

/** In-stock alternatives from other brands, priced near the recalled product. */
export async function safeAlternatives(product: Recalled, limit = 3): Promise<Listing[]> {
  const price = product.unitPriceCents / 100;
  const brand = product.brand ? norm(product.brand) : null;
  // The product type without the recalled brand's name, e.g. "Ceramic Space Heater with Remote".
  const query = product.brand ? product.name.replace(new RegExp(product.brand, "ig"), "").trim() : product.name;
  return cached(`alt:${query}:${product.brand}:${Math.round(price)}`, async () => {
    const products = await search({
      query,
      limit: 24,
      filters: { availability: ["InStock"], price: { min_price: Math.round(price * 0.6), max_price: Math.round(price * 1.5) } },
    });
    return products
      .filter((p) => !brand || !(p.brands ?? []).some((b) => norm(b.name) === brand))
      .filter((p) => !product.model || !norm(p.title).includes(norm(product.model)))
      .map(toListing)
      .filter((l) => l.retailers.length > 0 && l.image)
      .slice(0, limit);
  });
}

/** Both checks for one product; never throws (the recall page must render without Channel3). */
export async function marketCheck(product: Recalled) {
  if (!channel3Enabled()) return { enabled: false as const };
  const [onSale, alternatives] = await Promise.allSettled([stillOnSale(product), safeAlternatives(product)]);
  return {
    enabled: true as const,
    onSale: onSale.status === "fulfilled" ? onSale.value : [],
    alternatives: alternatives.status === "fulfilled" ? alternatives.value : [],
    error: [onSale, alternatives].find((r) => r.status === "rejected")?.reason?.message as string | undefined,
  };
}

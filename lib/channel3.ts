// Channel3 (https://trychannel3.com): normalized product data across 25,000+ retailers.
// Recall Desk uses it for two recall questions the seller's own data can't answer:
//   1. Is the recalled product still for sale elsewhere, and where? (search by brand + model)
//   2. What safe, in-stock alternative can we point a refunded buyer to? (the products Channel3 finds
//      most similar to the recalled one via POST /v1/similar, other brands only, near the original
//      price; a search by product type when the recalled product isn't in Channel3 or that call fails)
// Enabled when CHANNEL3_API_KEY is set. Results are cached in memory for a few hours.

const API = process.env.CHANNEL3_BASE_URL ?? "https://api.trychannel3.com";
const TTL_MS = 6 * 3600e3;

export const channel3Enabled = () => Boolean(process.env.CHANNEL3_API_KEY);

type Offer = { availability: "InStock" | "OutOfStock"; domain: string; url: string; price: { price: number; currency: string; compare_at_price?: number | null } };
type Product = {
  id: string;
  title: string;
  description?: string | null;
  key_features?: string[] | null;
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

/** Tests only: forget cached Channel3 responses. */
export const clearChannel3Cache = () => cache.clear();

async function post(path: string, body: Record<string, unknown>): Promise<Product[]> {
  const res = await fetch(`${API}${path}`, {
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

// POST /v1/search. Raw products are cached so the checks below share one call.
const search = (body: Record<string, unknown>) => cached(`search:${JSON.stringify(body)}`, () => post("/v1/search", body));

// POST /v1/similar: the products nearest to a Channel3 product id (same response shape as search; the
// docs say results are pinned to the seed's category). Takes filters like search, but no query.
const similar = (productId: string, body: Record<string, unknown>) => post("/v1/similar", { product_id: productId, ...body });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The model number has to appear in the listing's own text; brand and product type alone don't count.
const namesModel = (p: Product, model: string) => norm([p.title, p.description ?? "", ...(p.key_features ?? [])].join(" ")).includes(norm(model));

/** The recalled product's own Channel3 record, if its model number turns up in a search for it. */
const ownProduct = async (product: Recalled): Promise<Product | undefined> =>
  product.model
    ? (await search({ query: `${product.brand ?? ""} ${product.model}`.trim(), limit: 20 })).find((p) => namesModel(p, product.model!))
    : undefined;

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
  const products = await search({ query: `${product.brand ?? ""} ${product.model}`.trim(), limit: 20 });
  return products
    .filter((p) => namesModel(p, model))
    .map(toListing)
    .filter((l) => l.retailers.length > 0);
}

/** Where a set of alternatives came from: Channel3's similar-products endpoint, or a plain search. */
export type AlternativesVia = "similar" | "search";

/**
 * In-stock alternatives from other brands, priced near the recalled product.
 *  1. If the recalled product itself is in Channel3's catalog (its model number is in a listing), ask
 *     POST /v1/similar for the products nearest to it.
 *  2. Otherwise, or if that call fails or leaves nothing usable, search by product type (the fallback).
 */
export async function alternativesFor(product: Recalled, limit = 3): Promise<{ listings: Listing[]; via: AlternativesVia }> {
  const price = product.unitPriceCents / 100;
  const brand = product.brand ? norm(product.brand) : null;
  // The product type without the recalled brand's name, e.g. "Ceramic Space Heater with Remote".
  const query = product.brand ? product.name.replace(new RegExp(product.brand, "ig"), "").trim() : product.name;
  const filters = { availability: ["InStock"], price: { min_price: Math.round(price * 0.6), max_price: Math.round(price * 1.5) } };
  const usable = (products: Product[]) =>
    products
      .filter((p) => !brand || !(p.brands ?? []).some((b) => norm(b.name) === brand))
      .filter((p) => !product.model || !norm(p.title).includes(norm(product.model)))
      .map(toListing)
      .filter((l) => l.retailers.length > 0 && l.image)
      .slice(0, limit);

  return cached(`alt:${query}:${product.brand}:${product.model}:${Math.round(price)}`, async () => {
    const own = await ownProduct(product).catch(() => undefined);
    if (own) {
      try {
        // The source product isn't documented as excluded, so `usable` drops the recalled model itself.
        const brandIds = (own.brands ?? []).map((b) => b.id);
        const listings = usable(await similar(own.id, { limit: 30, filters: { ...filters, ...(brandIds.length ? { exclude_brand_ids: brandIds } : {}) } }));
        if (listings.length > 0) return { listings, via: "similar" as const };
      } catch {
        // fall through to the search below
      }
    }
    return { listings: usable(await search({ query, limit: 24, filters })), via: "search" as const };
  });
}

/** In-stock alternatives from other brands, priced near the recalled product. */
export async function safeAlternatives(product: Recalled, limit = 3): Promise<Listing[]> {
  return (await alternativesFor(product, limit)).listings;
}

/** Both checks for one product; never throws (the recall page must render without Channel3). */
export async function marketCheck(product: Recalled) {
  if (!channel3Enabled()) return { enabled: false as const };
  const [onSale, alternatives] = await Promise.allSettled([stillOnSale(product), alternativesFor(product)]);
  return {
    enabled: true as const,
    onSale: onSale.status === "fulfilled" ? onSale.value : [],
    alternatives: alternatives.status === "fulfilled" ? alternatives.value.listings : [],
    alternativesVia: alternatives.status === "fulfilled" ? alternatives.value.via : undefined,
    error: [onSale, alternatives].find((r) => r.status === "rejected")?.reason?.message as string | undefined,
  };
}

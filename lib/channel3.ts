// Channel3 (https://trychannel3.com): normalized product data across 25,000+ retailers.
// Recall Desk uses it for two recall questions the seller's own data can't answer:
//   1. Is the recalled product still for sale elsewhere, and where? (search by brand + model)
//   2. What safe, in-stock alternative can we point a refunded buyer to? (the products Channel3 finds
//      most similar to the recalled one via POST /v1/similar, other brands only, near the original
//      price; a search by product type when there is nothing to seed it with or that call fails)
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

/** One product per brand first, then the rest in their original order, so a list isn't three of the same brand. */
const diverse = (listings: Listing[]): Listing[] => {
  const seen = new Set<string>();
  const first: Listing[] = [];
  const rest: Listing[] = [];
  for (const l of listings) {
    const key = norm(l.brand) || l.id;
    (seen.has(key) ? rest : first).push(l);
    seen.add(key);
  }
  return [...first, ...rest];
};

/** Where a set of alternatives came from: Channel3's similar-products endpoint, or a plain search. */
export type AlternativesVia = "similar" | "search";

/**
 * In-stock alternatives from other brands, priced near the recalled product.
 *  1. Ask POST /v1/similar for the products nearest to a seed: the recalled product's own Channel3
 *     listing when its model number is in one, otherwise the closest in-stock match to its description.
 *  2. If there's no seed, that call fails, or nothing usable comes back, use the product-type search.
 */
export async function alternativesFor(
  product: Recalled,
  limit = 3,
): Promise<{ listings: Listing[]; via: AlternativesVia; seed?: "recalled product" | "closest match"; /** Why /v1/similar wasn't used, when it wasn't. */ note?: string }> {
  const price = product.unitPriceCents / 100;
  const brand = product.brand ? norm(product.brand) : null;
  // The product type without the recalled brand's name, e.g. "Ceramic Space Heater with Remote".
  const query = product.brand ? product.name.replace(new RegExp(product.brand, "ig"), "").trim() : product.name;
  const filters = { availability: ["InStock"], price: { min_price: Math.round(price * 0.6), max_price: Math.round(price * 1.5) } };
  const usable = (products: Product[]) =>
    diverse(
      products
        .filter((p) => !brand || !(p.brands ?? []).some((b) => norm(b.name) === brand))
        .filter((p) => !product.model || !norm(p.title).includes(norm(product.model)))
        .map(toListing)
        .filter((l) => l.retailers.length > 0 && l.image),
    ).slice(0, limit);
  const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

  return cached(`alt:${query}:${product.brand}:${product.model}:${Math.round(price)}`, async () => {
    let note: string | undefined;
    let typeHits: Product[] | undefined;
    const typeSearch = async () => (typeHits ??= await search({ query, limit: 24, filters }));

    let seed: Product | undefined = await ownProduct(product).catch((e) => {
      note = `seed lookup failed: ${why(e)}`;
      return undefined;
    });
    let seedKind: "recalled product" | "closest match" | undefined = seed ? "recalled product" : undefined;
    if (!seed) {
      // Not in Channel3 by model number: seed with the first product that is itself an acceptable alternative.
      seed = (await typeSearch()).find((p) => usable([p]).length > 0);
      if (seed) seedKind = "closest match";
      else note ??= "no in-stock match to seed /v1/similar with";
    }
    if (seed) {
      try {
        // The source product isn't documented as excluded; `usable` drops the recalled model, and the recalled
        // brand when we know its Channel3 id (only for the product's own listing).
        const brandIds = seedKind === "recalled product" ? (seed.brands ?? []).map((b) => b.id) : [];
        const found = await similar(seed.id, { limit: 30, filters: { ...filters, ...(brandIds.length ? { exclude_brand_ids: brandIds } : {}) } });
        const listings = usable(found);
        if (listings.length > 0) return { listings, via: "similar" as const, seed: seedKind };
        note = `/v1/similar returned ${found.length} product(s), none usable (other brand, in stock, with an image)`;
      } catch (e) {
        note = `/v1/similar failed: ${why(e)}`;
      }
    }
    return { listings: usable(await typeSearch()), via: "search" as const, note };
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
    alternativesSeed: alternatives.status === "fulfilled" ? alternatives.value.seed : undefined,
    alternativesNote: alternatives.status === "fulfilled" ? alternatives.value.note : undefined,
    error: [onSale, alternatives].find((r) => r.status === "rejected")?.reason?.message as string | undefined,
  };
}

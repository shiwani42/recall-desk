import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alternativesFor, clearChannel3Cache, marketCheck, safeAlternatives } from "@/lib/channel3";

type Call = { path: string; body: Record<string, unknown> };

const product = (id: string, title: string, brand: string, price = 45) => ({
  id,
  title,
  brands: [{ id: `b_${brand}`, name: brand }],
  images: [{ url: `https://img.example/${id}.jpg`, is_main_image: true }],
  offers: [{ availability: "InStock", domain: "shop.example", url: `https://shop.example/${id}`, price: { price, currency: "USD" } }],
});

const heater = { name: "DREO Compact Ceramic Space Heater", brand: "DREO", model: "DR-HSH015", unitPriceCents: 4999 };
const OWN_QUERY = "DREO DR-HSH015";
const own = product("own1", "DREO DR-HSH015 Ceramic Space Heater", "DREO", 49.99);
const paths = (calls: Call[]) => calls.map((c) => c.path);

// Replies per endpoint; `similar` may be a status code to simulate an error.
function mockChannel3(opts: { own?: unknown[]; type?: unknown[]; similar?: unknown[] | number }) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(init.body);
      calls.push({ path, body });
      if (path === "/v1/similar") {
        return typeof opts.similar === "number" ? new Response("boom", { status: opts.similar }) : Response.json({ products: opts.similar ?? [] });
      }
      return Response.json({ products: (body.query === OWN_QUERY ? opts.own : opts.type) ?? [] });
    }),
  );
  return calls;
}

beforeEach(() => {
  process.env.CHANNEL3_API_KEY = "test-key";
  clearChannel3Cache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CHANNEL3_API_KEY;
});

describe("alternativesFor", () => {
  it("seeds /v1/similar with the recalled product's own listing and keeps only other brands' in-stock products", async () => {
    const calls = mockChannel3({
      own: [own],
      similar: [product("a1", "Acme Mini Heater", "Acme"), product("d2", "DREO Tower Heater", "DREO"), product("m3", "Knockoff DR-HSH015 Heater", "Other")],
    });
    const r = await alternativesFor(heater);
    expect(r).toMatchObject({ via: "similar", seed: "recalled product" });
    expect(r.note).toBeUndefined();
    expect(r.listings.map((l) => l.id)).toEqual(["a1"]);

    const similar = calls.find((c) => c.path === "/v1/similar")!;
    expect(similar.body).toMatchObject({
      product_id: "own1",
      limit: 30,
      filters: { availability: ["InStock"], price: { min_price: 30, max_price: 75 }, exclude_brand_ids: ["b_DREO"] },
    });
    // The product-type search is only the fallback.
    expect(calls.map((c) => c.body.query).filter(Boolean)).toEqual([OWN_QUERY]);
  });

  it("seeds with the closest in-stock match when the model isn't in any listing", async () => {
    const calls = mockChannel3({
      own: [product("x", "Some Other Heater", "Acme")],
      type: [product("d1", "DREO Tower Heater", "DREO"), product("t1", "Acme Space Heater", "Acme"), product("t2", "Brandb Space Heater", "Brandb")],
      similar: [product("s1", "Zeta Ceramic Heater", "Zeta")],
    });
    const r = await alternativesFor(heater);
    expect(r).toMatchObject({ via: "similar", seed: "closest match" });
    expect(r.listings.map((l) => l.id)).toEqual(["s1"]);
    expect(paths(calls)).toEqual(["/v1/search", "/v1/search", "/v1/similar"]);
    // The seed skips the recalled brand's own product, and there's no brand id to exclude.
    const body = calls.find((c) => c.path === "/v1/similar")!.body;
    expect(body.product_id).toBe("t1");
    expect(body.filters).not.toHaveProperty("exclude_brand_ids");
  });

  it("seeds from a search for the product type when it has no model number", async () => {
    const calls = mockChannel3({ type: [product("t1", "Acme Space Heater", "Acme")], similar: [product("s1", "Zeta Ceramic Heater", "Zeta")] });
    const r = await alternativesFor({ ...heater, model: null });
    expect(r).toMatchObject({ via: "similar", seed: "closest match" });
    expect(paths(calls)).toEqual(["/v1/search", "/v1/similar"]);
  });

  it("falls back to the product-type search when /v1/similar errors", async () => {
    const calls = mockChannel3({ own: [own], similar: 500, type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor(heater);
    expect(r.via).toBe("search");
    expect(r.note).toMatch(/\/v1\/similar failed: Channel3 500/);
    expect(r.listings.map((l) => l.id)).toEqual(["t1"]);
    expect(paths(calls)).toEqual(["/v1/search", "/v1/similar", "/v1/search"]);
  });

  it("reuses the search it already made when a closest-match seed's /v1/similar call fails", async () => {
    const calls = mockChannel3({ type: [product("t1", "Acme Space Heater", "Acme")], similar: 422 });
    const r = await alternativesFor({ ...heater, model: null });
    expect(r).toMatchObject({ via: "search", listings: [{ id: "t1" }] });
    expect(r.note).toMatch(/Channel3 422/);
    expect(paths(calls)).toEqual(["/v1/search", "/v1/similar"]);
  });

  it("falls back when /v1/similar leaves nothing usable", async () => {
    mockChannel3({ own: [own], similar: [product("d2", "DREO Tower Heater", "DREO")], type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor(heater);
    expect(r).toMatchObject({ via: "search", listings: [{ id: "t1" }] });
    expect(r.note).toMatch(/returned 1 product\(s\), none usable/);
  });

  it("uses search alone when there is nothing to seed with", async () => {
    const calls = mockChannel3({ own: [], type: [] });
    const r = await alternativesFor(heater);
    expect(r).toMatchObject({ via: "search", listings: [], note: "no in-stock match to seed /v1/similar with" });
    expect(paths(calls)).toEqual(["/v1/search", "/v1/search"]);
  });

  it("prefers one product per brand, then tops up from the same brands", async () => {
    mockChannel3({
      own: [own],
      similar: [product("g1", "Garvee A", "GARVEE"), product("g2", "Garvee B", "GARVEE"), product("g3", "Garvee C", "GARVEE"), product("l1", "Lasko A", "Lasko"), product("s1", "Slick A", "Slickblue")],
    });
    expect((await alternativesFor(heater, 3)).listings.map((l) => l.id)).toEqual(["g1", "l1", "s1"]);
    clearChannel3Cache();
    mockChannel3({ own: [own], similar: [product("g1", "Garvee A", "GARVEE"), product("g2", "Garvee B", "GARVEE"), product("l1", "Lasko A", "Lasko")] });
    expect((await alternativesFor(heater, 3)).listings.map((l) => l.id)).toEqual(["g1", "l1", "g2"]);
  });

  it("drops listings without an image or an in-stock offer, and respects the limit", async () => {
    const noImage = { ...product("n1", "Acme No Image", "Acme"), images: [] };
    const oos = { ...product("o1", "Acme Sold Out", "Acme"), offers: [{ ...product("o1", "x", "Acme").offers[0], availability: "OutOfStock" }] };
    mockChannel3({ own: [own], similar: [noImage, oos, ...["a", "b", "c", "d"].map((k) => product(k, `Brand${k} Heater`, `Brand${k}`))] });
    const listings = await safeAlternatives(heater, 3);
    expect(listings.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
});

describe("marketCheck", () => {
  it("reports where the alternatives came from", async () => {
    mockChannel3({ own: [own], similar: [product("a1", "Acme Mini Heater", "Acme")] });
    const r = await marketCheck(heater);
    expect(r).toMatchObject({ enabled: true, alternativesVia: "similar", alternativesSeed: "recalled product" });
    // And the recalled model is still on sale at a retailer.
    expect(r.enabled && r.onSale.map((l) => l.id)).toEqual(["own1"]);
  });

  it("is disabled without an API key", async () => {
    delete process.env.CHANNEL3_API_KEY;
    expect(await marketCheck(heater)).toEqual({ enabled: false });
  });
});

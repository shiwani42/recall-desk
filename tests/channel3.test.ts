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
        return typeof opts.similar === "number"
          ? new Response("boom", { status: opts.similar })
          : Response.json({ products: opts.similar ?? [] });
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
  it("asks /v1/similar about the recalled product itself and keeps only other brands' in-stock products", async () => {
    const calls = mockChannel3({
      own: [own],
      similar: [product("a1", "Acme Mini Heater", "Acme"), product("d2", "DREO Tower Heater", "DREO"), product("m3", "Knockoff DR-HSH015 Heater", "Other")],
    });
    const r = await alternativesFor(heater);
    expect(r.via).toBe("similar");
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

  it("falls back to a product-type search when /v1/similar errors", async () => {
    const calls = mockChannel3({ own: [own], similar: 500, type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor(heater);
    expect(r.via).toBe("search");
    expect(r.listings.map((l) => l.id)).toEqual(["t1"]);
    expect(calls.map((c) => c.path)).toEqual(["/v1/search", "/v1/similar", "/v1/search"]);
  });

  it("falls back when /v1/similar leaves nothing usable", async () => {
    mockChannel3({ own: [own], similar: [product("d2", "DREO Tower Heater", "DREO")], type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor(heater);
    expect(r).toMatchObject({ via: "search", listings: [{ id: "t1" }] });
  });

  it("doesn't call /v1/similar when the model number isn't in any listing (not the recalled product)", async () => {
    const calls = mockChannel3({ own: [product("x", "Some Other Heater", "Acme")], type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor(heater);
    expect(r.via).toBe("search");
    expect(calls.some((c) => c.path === "/v1/similar")).toBe(false);
  });

  it("goes straight to search for a product with no model number", async () => {
    const calls = mockChannel3({ type: [product("t1", "Acme Space Heater", "Acme")] });
    const r = await alternativesFor({ ...heater, model: null });
    expect(r.via).toBe("search");
    expect(calls.map((c) => c.path)).toEqual(["/v1/search"]);
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
    expect(r).toMatchObject({ enabled: true, alternativesVia: "similar" });
    // And the recalled model is still on sale at a retailer.
    expect(r.enabled && r.onSale.map((l) => l.id)).toEqual(["own1"]);
  });

  it("is disabled without an API key", async () => {
    delete process.env.CHANNEL3_API_KEY;
    expect(await marketCheck(heater)).toEqual({ enabled: false });
  });
});

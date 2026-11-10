import { describe, expect, it } from "vitest";
import { normalizeCpsc, severityFor } from "@/lib/cpsc";
import { matchNotice, type CatalogItem } from "@/lib/recalls/matcher";

// Shape and content of a real CPSC record (recall 27054), trimmed.
const dreo = normalizeCpsc({
  RecallNumber: "27054",
  RecallDate: "2026-10-29T00:00:00",
  Title: "DREO Recalls DR-HSH015 Space Heaters Due to Fire and Burn Hazards",
  Description: "This recall involves DREO space heaters, model number DR-HSH015. The ceramic, electric heaters are black.",
  URL: "https://cpsc.gov/Recalls/2027/DREO-Recalls-DR-HSH015-Space-Heaters-Due-to-Fire-and-Burn-Hazards",
  Products: [{ Name: "DREO Space Heaters, model DR-HSH015", Model: "" }],
  Hazards: [{ Name: "The recalled space heaters can overheat and ignite, posing fire and burn hazards." }],
  Remedies: [{ Name: "Consumers should stop using the recalled space heaters immediately and contact DREO for a free replacement space heater. Consumers will be asked to unplug it." }],
  RemedyOptions: [{ Option: "Replace" }],
  Injuries: [{ Name: "DREO has received 17 reports of space heaters igniting." }],
  Manufacturers: [],
  Retailers: [{ Name: "Sold At:\nCostco stores nationwide from September 2025 through October 2026." }],
  ProductUPCs: [],
});

const catalog: CatalogItem[] = [
  { sku: "DRE-HSH015", name: "DREO Ceramic Space Heater with Remote", description: "", brand: "DREO", model: "DR-HSH015", upc: null },
  { sku: "DRE-OTHER", name: "DREO Tower Space Heater", description: "", brand: "DREO", model: "DR-HTF007", upc: null },
  { sku: "HTR-200", name: "Compact Ceramic Space Heater", description: "1500W", brand: "Small Seller Co.", model: "HTR-200", upc: null },
  { sku: "DRE-FAN", name: "DREO Pedestal Fan", description: "", brand: "DREO", model: "DR-HAF004", upc: null },
];

describe("normalizeCpsc", () => {
  it("extracts the fields a recall needs", () => {
    expect(dreo).toMatchObject({
      id: "27054",
      date: "2026-10-29",
      brands: ["DREO"],
      remedies: ["replace"],
      severity: "high",
      instructions: "Consumers should stop using the recalled space heaters immediately and contact DREO for a free replacement space heater.",
      soldAt: "Costco stores nationwide from September 2025 through October 2026.",
    });
  });
  it("rates fire, choking and similar hazards high", () => {
    expect(severityFor("posing a choking hazard")).toBe("high");
    expect(severityFor("the label may peel off")).toBe("medium");
  });
});

describe("matchNotice", () => {
  const m = matchNotice(dreo, catalog);
  it("matches the exact model strongly", () => {
    expect(m[0]).toMatchObject({ sku: "DRE-HSH015", confidence: "strong" });
    expect(m[0].reasons[0]).toMatch(/Model DR-HSH015/);
  });
  it("flags the same brand and product type as only possible", () => {
    expect(m.find((x) => x.sku === "DRE-OTHER")).toMatchObject({ confidence: "possible" });
  });
  it("never matches on product type alone (different brand heater)", () => {
    expect(m.find((x) => x.sku === "HTR-200")).toBeUndefined();
  });
  it("ignores same-brand products of a different type", () => {
    expect(m.find((x) => x.sku === "DRE-FAN")).toBeUndefined();
  });
  it("matches by UPC", () => {
    const withUpc = { ...dreo, upcs: ["012345678905"] };
    expect(matchNotice(withUpc, [{ ...catalog[2], upc: "0-12345-67890-5" }])[0]).toMatchObject({ sku: "HTR-200", score: 1 });
  });
});

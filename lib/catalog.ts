// Demo catalog of physical goods: the kinds of products that actually get recalled.
// brand/model/UPC are what official recall notices reference, so they drive automatic matching.
// DRE-HSH015 is a real product under a real CPSC recall (Oct 2026), resold here to demo recall watch.
export const CATALOG = [
  { sku: "HTR-200", name: "Compact Ceramic Space Heater", description: "1500W, tip-over switch, 3 heat settings.", brand: "Small Seller Co.", model: "HTR-200", upc: null, unitPriceCents: 4999 },
  { sku: "DRE-HSH015", name: "DREO Ceramic Space Heater with Remote", description: "DREO model DR-HSH015, black, 11.5 in wide.", brand: "DREO", model: "DR-HSH015", upc: null, unitPriceCents: 8999 },
  { sku: "CHG-65W", name: "65W USB-C GaN Charger", description: "Dual-port fast charger for laptops and phones.", brand: "Small Seller Co.", model: "CHG-65W", upc: null, unitPriceCents: 1999 },
  { sku: "TOY-RKT", name: "Stomp Rocket Kids Kit", description: "Foam rockets and launcher, ages 5+.", brand: "Small Seller Co.", model: "TOY-RKT", upc: null, unitPriceCents: 1299 },
  { sku: "KTL-1L", name: "Glass Electric Kettle 1L", description: "Auto shut-off, boil-dry protection.", brand: "Small Seller Co.", model: "KTL-1L", upc: null, unitPriceCents: 2499 },
  { sku: "BTL-750", name: "Insulated Steel Bottle 750ml", description: "Keeps drinks cold for 24 hours.", brand: "Small Seller Co.", model: "BTL-750", upc: null, unitPriceCents: 1400 },
] as const;

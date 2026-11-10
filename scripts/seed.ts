// Seeds the catalog and creates REAL PayPal sandbox sales (card-funded, captured
// server-side) so there's SKU-level sales history to run recalls against.
//
//   npm run db:seed            # add sales
//   npm run db:seed -- --reset # wipe the local DB first
import fs from "node:fs";
import path from "node:path";
import { CATALOG } from "@/lib/catalog";
import { getDb, t } from "@/lib/db";
import { buildOrderRequest, describePayPalError, ordersController } from "@/lib/paypal/orders";
import { recordSale, saleFromPayPalOrder } from "@/lib/sales";

const DAY = 864e5;
const dbFile = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "recall.db");

if (process.argv.includes("--reset")) {
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
  console.log("✓ reset", dbFile);
}

const db = getDb();

// --if-empty: used on hosts with ephemeral disks (Render free). Seed only a fresh database.
if (process.argv.includes("--if-empty")) {
  const existing = db.select({ id: t.sales.id }).from(t.sales).limit(1).all();
  if (existing.length) {
    console.log("✓ database already has sales; skipping seed");
    process.exit(0);
  }
}

for (const p of CATALOG) {
  db.insert(t.products).values(p).onConflictDoUpdate({ target: t.products.sku, set: p }).run();
}
console.log(`✓ catalog: ${CATALOG.length} products`);

const bySku = Object.fromEntries(CATALOG.map((p) => [p.sku, p]));
type Buyer = { given: string; surname: string; email: string; line1: string; city: string; state: string; zip: string };
const B = (given: string, surname: string, line1: string, city: string, state: string, zip: string): Buyer => ({
  given, surname, email: `${given}.${surname}@example.com`.toLowerCase(), line1, city, state, zip,
});

// Fictional buyers. example.com is reserved, so nothing is ever delivered anywhere real.
const ORDERS: { buyer: Buyer; items: [string, number][] }[] = [
  { buyer: B("Maria", "Lopez", "410 Alder Ave", "Austin", "TX", "78701"), items: [["HTR-200", 1]] },
  { buyer: B("James", "Chen", "88 Harbor St", "Seattle", "WA", "98101"), items: [["HTR-200", 1], ["CHG-65W", 2]] },
  { buyer: B("Aisha", "Khan", "12 Elm Ct", "Columbus", "OH", "43004"), items: [["TOY-RKT", 2], ["BTL-750", 1]] },
  { buyer: B("Tom", "Becker", "905 Pine Rd", "Denver", "CO", "80202"), items: [["CHG-65W", 1]] },
  { buyer: B("Priya", "Nair", "77 Lake Dr", "Raleigh", "NC", "27601"), items: [["KTL-1L", 1], ["HTR-200", 1]] },
  { buyer: B("Lucas", "Moreau", "3 Birch Ln", "Portland", "OR", "97201"), items: [["TOY-RKT", 1]] },
  { buyer: B("Emma", "Wilson", "650 Oak Blvd", "Tampa", "FL", "33602"), items: [["BTL-750", 2]] },
  { buyer: B("Kenji", "Sato", "21 Cedar Way", "San Jose", "CA", "95131"), items: [["CHG-65W", 1], ["KTL-1L", 1]] },
  { buyer: B("Grace", "Okafor", "45 Summit Ave", "Minneapolis", "MN", "55401"), items: [["DRE-HSH015", 1]] },
  { buyer: B("Ravi", "Menon", "230 Bay St", "Madison", "WI", "53703"), items: [["DRE-HSH015", 1], ["BTL-750", 1]] },
];

// Older sales (from before this system existed) with no PayPal capture on file.
// PayPal only allows refunds within 180 days of capture, so these exercise the payout path.
const LEGACY: { buyer: Buyer; items: [string, number][]; daysAgo: number }[] = [
  { buyer: B("Olivia", "Brown", "14 Maple St", "Boston", "MA", "02108"), items: [["HTR-200", 1]], daysAgo: 240 },
  { buyer: B("Daniel", "Park", "300 River Rd", "Chicago", "IL", "60601"), items: [["CHG-65W", 1]], daysAgo: 300 },
  { buyer: B("Sofia", "Rossi", "9 Vine St", "Phoenix", "AZ", "85004"), items: [["TOY-RKT", 1]], daysAgo: 400 },
  { buyer: B("Hannah", "Weiss", "8 Orchard Rd", "Buffalo", "NY", "14201"), items: [["DRE-HSH015", 1]], daysAgo: 210 },
];

const lineItems = (items: [string, number][]) =>
  items.map(([sku, quantity]) => ({ sku, name: bySku[sku].name, description: bySku[sku].description, unitPriceCents: bySku[sku].unitPriceCents, quantity }));

async function main() {
let ok = 0;
for (const { buyer, items } of ORDERS) {
  const body = buildOrderRequest(lineItems(items));
  body.payer = { emailAddress: buyer.email, name: { givenName: buyer.given, surname: buyer.surname } };
  body.purchaseUnits[0].shipping = {
    name: { fullName: `${buyer.given} ${buyer.surname}` },
    address: { addressLine1: buyer.line1, adminArea2: buyer.city, adminArea1: buyer.state, postalCode: buyer.zip, countryCode: "US" },
  };
  // Sandbox test Visa. Card + intent CAPTURE completes the payment in one call.
  body.paymentSource = { card: { number: "4032039317984658", expiry: "2030-12", securityCode: "123", name: `${buyer.given} ${buyer.surname}` } };

  try {
    const { result } = await ordersController().createOrder({
      body,
      paypalRequestId: crypto.randomUUID(),
      prefer: "return=representation",
    });
    const sale = saleFromPayPalOrder(result, "seed");
    // Card payments don't return a PayPal account email; the storefront collected it at checkout.
    sale.buyerEmail ??= buyer.email;
    sale.buyerName ??= `${buyer.given} ${buyer.surname}`;
    recordSale(db, sale);
    ok++;
    console.log(`  ✓ ${sale.buyerName?.padEnd(14)} ${items.map(([s, q]) => `${q}×${s}`).join(", ").padEnd(24)} capture ${sale.captureId}`);
  } catch (err) {
    console.error(`  ✗ ${buyer.given} ${buyer.surname}: ${describePayPalError(err)}`);
  }
}
console.log(`✓ sandbox sales captured: ${ok}/${ORDERS.length}`);

for (const { buyer, items, daysAgo } of LEGACY) {
  recordSale(db, {
    source: "legacy",
    buyerName: `${buyer.given} ${buyer.surname}`,
    buyerEmail: buyer.email,
    shipAddress: { name: `${buyer.given} ${buyer.surname}`, line1: buyer.line1, city: buyer.city, state: buyer.state, postalCode: buyer.zip, countryCode: "US" },
    currency: "USD",
    capturedAt: new Date(Date.now() - daysAgo * DAY),
    items: lineItems(items).map(({ sku, name, quantity, unitPriceCents }) => ({ sku, name, quantity, unitPriceCents })),
  });
}
console.log(`✓ legacy sales: ${LEGACY.length}`);

console.log(`DB: ${await db.$count(t.sales)} sales, ${await db.$count(t.saleItems)} line items`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

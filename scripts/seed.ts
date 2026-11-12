// Seeds the catalog and creates REAL PayPal sandbox sales (card-funded, captured
// server-side) so there's SKU-level sales history to run recalls against.
//
//   npm run db:seed            # add sales
//   npm run db:seed -- --reset # wipe the local DB first
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { CATALOG } from "@/lib/catalog";
import { getDb, t } from "@/lib/db";
import { buildOrderRequest, describePayPalError, ordersController } from "@/lib/paypal/orders";
import { notifyBuyers } from "@/lib/recalls/notify";
import { markShipped, resolveCase } from "@/lib/recalls/execute";
import { createRecall, matchRecall } from "@/lib/recalls/service";
import { syncRecall } from "@/lib/recalls/sync";
import { recordSale, saleFromPayPalOrder, type SaleInput } from "@/lib/sales";
import { addError, isCardDecline, shouldStopCapturing, writeSeedReport, type SeedReport } from "@/lib/seed-report";

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

const TEST_CARDS = ["4111111111111111", "4012888888881881", "5555555555554444", "4032039317984658"];
let nextCard = 0;

async function captureWithAnyCard(body: ReturnType<typeof buildOrderRequest>, name: string) {
  let lastErr: unknown;
  for (let i = 0; i < TEST_CARDS.length; i++) {
    const number = TEST_CARDS[(nextCard + i) % TEST_CARDS.length];
    body.paymentSource = { card: { number, expiry: "2030-12", securityCode: "123", name } };
    try {
      const { result } = await ordersController().createOrder({ body, paypalRequestId: crypto.randomUUID(), prefer: "return=representation" });
      nextCard = (nextCard + i + 1) % TEST_CARDS.length;
      return result;
    } catch (err) {
      lastErr = err;
      if (!isCardDecline(describePayPalError(err))) throw err;
    }
  }
  throw lastErr;
}

const lineItems = (items: [string, number][]) =>
  items.map(([sku, quantity]) => ({ sku, name: bySku[sku].name, description: bySku[sku].description, unitPriceCents: bySku[sku].unitPriceCents, quantity }));

async function main() {
const report: SeedReport = {
  at: "",
  sandboxSales: { captured: 0, attempted: 0, skipped: 0, errors: [] },
  payouts: { sent: 0, failed: 0, outOfFunds: false },
};
let ok = 0;
let failedInARow = 0;
for (const [index, { buyer, items }] of ORDERS.entries()) {
  // The sandbox declines test cards after heavy use; once it clearly is, stop rather than add load.
  if (shouldStopCapturing(failedInARow)) {
    report.sandboxSales.skipped = ORDERS.length - index;
    console.error(`  ✗ ${failedInARow} orders in a row failed on every card; skipping the remaining ${report.sandboxSales.skipped} sandbox captures`);
    break;
  }
  report.sandboxSales.attempted++;
  const body = buildOrderRequest(lineItems(items));
  body.payer = { emailAddress: buyer.email, name: { givenName: buyer.given, surname: buyer.surname } };
  body.purchaseUnits[0].shipping = {
    name: { fullName: `${buyer.given} ${buyer.surname}` },
    address: { addressLine1: buyer.line1, adminArea2: buyer.city, adminArea1: buyer.state, postalCode: buyer.zip, countryCode: "US" },
  };
  // Sandbox test cards. Card + intent CAPTURE completes the payment in one call. PayPal's sandbox
  // starts declining a card (PAYER_CANNOT_PAY) after heavy use, so rotate and fall back.
  try {
    const result = await captureWithAnyCard(body, `${buyer.given} ${buyer.surname}`);
    const sale = saleFromPayPalOrder(result, "seed");
    // Card payments don't return a PayPal account email; the storefront collected it at checkout.
    sale.buyerEmail ??= buyer.email;
    sale.buyerName ??= `${buyer.given} ${buyer.surname}`;
    recordSale(db, sale);
    ok++;
    failedInARow = 0;
    console.log(`  ✓ ${sale.buyerName?.padEnd(14)} ${items.map(([s, q]) => `${q}×${s}`).join(", ").padEnd(24)} capture ${sale.captureId}`);
  } catch (err) {
    failedInARow++;
    addError(report.sandboxSales.errors, describePayPalError(err));
    console.error(`  ✗ ${buyer.given} ${buyer.surname}: ${describePayPalError(err)}`);
  }
}
report.sandboxSales.captured = ok;
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

// Imported order history: the shop's earlier orders, from before it took PayPal through this app.
// Synthetic and deterministic (same rows on every seed), with no PayPal capture, so any refund on
// these goes out as a PayPal payout. It gives the analytics page months of history to work with.
if (!process.argv.includes("--no-history")) {
  const history = orderHistory();
  for (const h of history) recordSale(db, h);
  console.log(`✓ imported order history: ${history.length} orders`);

  // A recall from two months ago, run through the real pipeline: matched to buyers, notices logged,
  // and most buyers refunded with real sandbox payouts (the rest haven't replied yet).
  const now = new Date();
  const recall = createRecall(db, {
    title: "Stomp Rocket Kids Kit: launcher cap can detach",
    hazard: "The launcher's end cap can come off and is a choking hazard for young children.",
    severity: "high",
    instructions: "Take the kit away from children and stop using it.",
    skus: ["TOY-RKT"],
    remedies: ["refund", "replace"],
    replacementStock: 20,
    soldFrom: new Date(now.getTime() - 420 * DAY),
    soldTo: new Date(now.getTime() - 60 * DAY),
  }, new Date(now.getTime() - 58 * DAY));
  const matched = matchRecall(db, recall.id);
  await notifyBuyers(db, recall.id, process.env.APP_URL ?? process.env.RENDER_EXTERNAL_URL ?? "http://localhost:3000");
  const cases = db.select({ id: t.recallCases.id }).from(t.recallCases).where(eq(t.recallCases.recallId, recall.id)).all();
  // Of every 6 buyers: 1 took a refund, 2 asked for a replacement (half already shipped), 3 haven't
  // replied. Few payouts on purpose: every Render boot reseeds, and payouts draw down the sandbox
  // business balance faster than the 10 seeded sales refill it (PayPal then answers INSUFFICIENT_FUNDS).
  let paid = 0, replaced = 0, outOfFunds = false, payoutFailures = 0;
  for (const [i, c] of cases.entries()) {
    const slot = i % 6;
    if (slot >= 3) continue;
    let remedy: "refund" | "replace" = slot === 0 ? "refund" : "replace";
    if (remedy === "refund" && outOfFunds) continue; // leave them "notified" rather than failing more payouts
    let r = await resolveCase(db, c.id, remedy, "buyer");
    // Replacement stock ran out: the buyer takes a refund instead, as the buyer page would offer.
    if (!r.ok && remedy === "replace" && !outOfFunds) r = await resolveCase(db, c.id, (remedy = "refund"), "buyer");
    if (!r.ok) {
      payoutFailures++;
      console.error(`  ✗ case ${c.id}: ${r.error}`);
      if (r.error.includes("INSUFFICIENT_FUNDS")) {
        outOfFunds = true;
        console.error("  ✗ sandbox balance is out of funds; skipping the remaining seeded payouts");
      }
      continue;
    }
    if (remedy === "refund") paid++;
    else if (++replaced % 2 === 1) markShipped(db, c.id, `1Z${String(c.id).padStart(8, "0")}`);
  }
  report.payouts = { sent: paid, failed: payoutFailures, outOfFunds };
  await syncRecall(db, recall.id);
  console.log(`✓ past recall ${recall.id}: ${matched.totalCases} cases, ${paid} refunded by sandbox payout, ${replaced} replacements`);
}

console.log(`DB: ${await db.$count(t.sales)} sales, ${await db.$count(t.saleItems)} line items`);
report.at = new Date().toISOString();
writeSeedReport(report);
}

// Deterministic PRNG, so the history is identical on every machine and every Render boot.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function orderHistory() {
  const rand = rng(20261112);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const weighted = <T,>(xs: readonly (readonly [T, number])[]) => {
    let r = rand() * xs.reduce((s, [, w]) => s + w, 0);
    for (const [x, w] of xs) if ((r -= w) <= 0) return x;
    return xs[0][0];
  };
  const FIRST = ["Ava", "Ben", "Chloe", "Diego", "Ella", "Farah", "Gabe", "Hana", "Ivan", "Jade", "Kofi", "Lena", "Mateo", "Nora", "Omar", "Pia", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Victor", "Wren", "Yusuf", "Zoe"];
  const LAST = ["Adams", "Baker", "Cruz", "Diaz", "Evans", "Fischer", "Garcia", "Hughes", "Ito", "Jensen", "Kim", "Lewis", "Murphy", "Nguyen", "Ortiz", "Patel", "Reyes", "Silva", "Turner", "Walsh", "Young"];
  const PLACES = [
    ["Los Angeles", "CA", 14], ["San Diego", "CA", 6], ["Houston", "TX", 9], ["Dallas", "TX", 6], ["New York", "NY", 10], ["Brooklyn", "NY", 5],
    ["Miami", "FL", 7], ["Orlando", "FL", 4], ["Chicago", "IL", 7], ["Philadelphia", "PA", 5], ["Columbus", "OH", 4], ["Atlanta", "GA", 5],
    ["Charlotte", "NC", 4], ["Seattle", "WA", 5], ["Denver", "CO", 4], ["Phoenix", "AZ", 4], ["Boston", "MA", 4], ["Detroit", "MI", 3],
    ["Minneapolis", "MN", 3], ["Portland", "OR", 3], ["Nashville", "TN", 3], ["Newark", "NJ", 3], ["Richmond", "VA", 2], ["Madison", "WI", 2],
  ] as const;
  const SKUS = [["CHG-65W", 30], ["BTL-750", 26], ["KTL-1L", 18], ["HTR-200", 14], ["TOY-RKT", 16], ["DRE-HSH015", 4]] as const;
  // Heaters sell in winter, toys before the holidays.
  const season = (sku: string, month: number) =>
    sku === "HTR-200" || sku === "DRE-HSH015" ? (month >= 9 || month <= 1 ? 2.2 : 0.4) : sku === "TOY-RKT" && (month === 10 || month === 11) ? 2 : 1;

  const out: SaleInput[] = [];
  for (let i = 0; i < 280; i++) {
    const daysAgo = 8 + Math.floor(rand() * 420);
    const capturedAt = new Date(Date.now() - daysAgo * DAY - Math.floor(rand() * DAY));
    const month = capturedAt.getUTCMonth();
    const first = pick(FIRST), last = pick(LAST);
    const [city, state] = weighted(PLACES.map(([c, s, w]) => [[c, s] as const, w] as const));
    const lines = new Map<string, number>();
    const count = rand() < 0.25 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const sku = weighted(SKUS.map(([s, w]) => [s, w * season(s, month)] as const));
      lines.set(sku, (lines.get(sku) ?? 0) + (rand() < 0.15 ? 2 : 1));
    }
    out.push({
      source: "legacy",
      buyerName: `${first} ${last}`,
      buyerEmail: `${first}.${last}.${i}@example.com`.toLowerCase(),
      shipAddress: { name: `${first} ${last}`, line1: `${100 + Math.floor(rand() * 900)} ${pick(["Oak", "Main", "Park", "Lake", "Hill", "Maple"])} St`, city, state, postalCode: "00000", countryCode: "US" },
      currency: "USD",
      capturedAt,
      items: [...lines].map(([sku, quantity]) => ({ sku, name: bySku[sku].name, quantity, unitPriceCents: bySku[sku].unitPriceCents })),
    });
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

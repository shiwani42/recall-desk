// Sandbox only: tops up the sandbox business balance with test-card payments, so demo refunds and
// payouts don't fail with INSUFFICIENT_FUNDS. Nothing is recorded in the sales ledger.
//   npx tsx --env-file-if-exists=.env.local scripts/fund-sandbox.ts [count] [amount]
import { buildOrderRequest, describePayPalError, ordersController } from "@/lib/paypal/orders";
import { getAccessToken } from "@/lib/paypal/client";

const CARDS = ["4111111111111111", "4012888888881881", "5555555555554444", "4032039317984658"];

async function balance() {
  const r = await fetch("https://api-m.sandbox.paypal.com/v1/reporting/balances?currency_code=USD", { headers: { Authorization: `Bearer ${await getAccessToken()}` } });
  const j = await r.json();
  return j.balances?.[0]?.available_balance?.value ?? "?";
}

async function main() {
  if (process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT === "production") throw new Error("Sandbox only.");
  const count = Number(process.argv[2] ?? 1);
  const cents = Math.round(Number(process.argv[3] ?? 100) * 100);
  console.log("available before:", await balance());
  for (let i = 0; i < count; i++) {
    const body = buildOrderRequest([{ sku: "SANDBOX-FUNDS", name: "Sandbox balance top-up", description: "", unitPriceCents: cents, quantity: 1 }]);
    let done = false;
    for (const number of CARDS) {
      body.paymentSource = { card: { number, expiry: "2030-12", securityCode: "123", name: "Sandbox Funding" } };
      try {
        const { result } = await ordersController().createOrder({ body, paypalRequestId: crypto.randomUUID(), prefer: "return=representation" });
        console.log(`  ✓ ${result.purchaseUnits?.[0]?.payments?.captures?.[0]?.status} $${cents / 100}`);
        done = true;
        break;
      } catch (err) {
        if (!describePayPalError(err).includes("PAYER_CANNOT_PAY")) throw err;
      }
    }
    if (!done) console.log("  ✗ every test card was declined");
  }
  console.log("available after:", await balance());
}
main().catch((e) => { console.error(describePayPalError(e)); process.exit(1); });

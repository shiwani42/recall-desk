// Checks that .env.local has working PayPal credentials.
// Usage: npm run paypal:check
const env = process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT ?? "sandbox";
const id = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const secret = process.env.PAYPAL_CLIENT_SECRET;

if (!id || !secret) {
  console.error("✗ Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.local");
  console.error("  Get them at https://developer.paypal.com/dashboard/applications/sandbox");
  process.exit(1);
}

const base = env === "production" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const res = await fetch(`${base}/v1/oauth2/token`, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: "grant_type=client_credentials",
});

if (!res.ok) {
  console.error(`✗ PayPal rejected the credentials (${env}): HTTP ${res.status}`);
  console.error("  " + (await res.text()));
  console.error("  Check the Client ID/Secret match the environment (sandbox vs live).");
  process.exit(1);
}

const body = await res.json();
console.log(`✓ PayPal ${env} credentials work. App ID: ${body.app_id}, token expires in ${body.expires_in}s`);
console.log(`  Webhook ID: ${process.env.PAYPAL_WEBHOOK_ID ? "set" : "not set (optional, needed for /api/paypal/webhook)"}`);

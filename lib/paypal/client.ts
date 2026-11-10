import { Client, Environment, LogLevel } from "@paypal/paypal-server-sdk";

// Server-only. Never import this from a "use client" file.

export const isProduction = process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT === "production";

export const PAYPAL_API_BASE = isProduction
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var ${name}. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

let client: Client | undefined;

// One configured client, shared by every controller (Orders, Payments, Vault, Subscriptions).
// The SDK handles OAuth2 client-credentials tokens and refreshes them for you.
export function getPayPalClient(): Client {
  client ??= new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: requireEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID"),
      oAuthClientSecret: requireEnv("PAYPAL_CLIENT_SECRET"),
    },
    environment: isProduction ? Environment.Production : Environment.Sandbox,
    timeout: 0,
    // Set PAYPAL_DEBUG=1 to log every PayPal request/response body (sandbox only).
    ...(process.env.PAYPAL_DEBUG && {
      logging: { logLevel: LogLevel.Info, logRequest: { logBody: !isProduction }, logResponse: { logBody: !isProduction } },
    }),
  });
  return client;
}

// Raw REST access token, for APIs the server SDK doesn't wrap (e.g. webhook verification).
export async function getAccessToken(): Promise<string> {
  const id = requireEnv("NEXT_PUBLIC_PAYPAL_CLIENT_ID");
  const secret = requireEnv("PAYPAL_CLIENT_SECRET");
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`PayPal OAuth failed (${res.status}): ${await res.text()}`);
  }
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

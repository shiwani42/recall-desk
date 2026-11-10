import { getAccessToken, isProduction } from "@/lib/paypal/client";

// GET /api/paypal/health — confirms the server can authenticate with PayPal.
export async function GET() {
  const environment = isProduction ? "production" : "sandbox";
  try {
    await getAccessToken();
    return Response.json({ ok: true, environment });
  } catch (err) {
    return Response.json(
      { ok: false, environment, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

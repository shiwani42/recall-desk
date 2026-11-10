import { connection } from "next/server";
import { getDb, t } from "@/lib/db";

// Cheap liveness check for the host (Render). Doesn't call PayPal; see /api/paypal/health for that.
export async function GET() {
  await connection(); // otherwise Next prerenders this at build time with an empty DB
  const sales = await getDb().$count(t.sales);
  return Response.json({ ok: true, sales });
}

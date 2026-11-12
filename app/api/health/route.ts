import { connection } from "next/server";
import { getDb, t } from "@/lib/db";
import { readSeedReport } from "@/lib/seed-report";

// Cheap liveness check for the host (Render). Doesn't call PayPal; see /api/paypal/health for that.
// `seed` is what the boot seed did (sandbox sales captured, payouts sent), so a short ledger can be explained.
export async function GET() {
  await connection(); // otherwise Next prerenders this at build time with an empty DB
  const sales = await getDb().$count(t.sales);
  const seed = readSeedReport();
  return Response.json({ ok: true, sales, ...(seed && { seed }) });
}

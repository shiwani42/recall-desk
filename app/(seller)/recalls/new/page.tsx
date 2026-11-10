import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import NewRecallWorkspace from "@/components/NewRecallWorkspace";
import { Card, Skeleton } from "@/components/ui";
import { aiEnabled } from "@/lib/ai";
import { getDb } from "@/lib/db";
import { catalogItems } from "@/lib/products";
import { skuSalesSummary } from "@/lib/recalls/queries";
import { recallWatch } from "@/lib/recalls/watch";

export default function NewRecallPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-foreground">← Recalls</Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">New recall</h1>
        <p className="mt-1 text-sm text-muted">Choose the recalled SKUs. Every matching PayPal sale becomes a case to resolve.</p>
      </div>
      <Suspense fallback={<Skeleton rows={6} />}>
        <Workspace />
      </Suspense>
    </div>
  );
}

async function Workspace() {
  await connection();
  const db = getDb();
  const skus = skuSalesSummary(db);
  if (skus.length === 0) {
    return <Card className="p-6 text-sm text-muted">No sales yet. Run <code className="font-mono">npm run db:seed</code> or make a sale in the storefront.</Card>;
  }
  const watch = await recallWatch(db, catalogItems());
  return <NewRecallWorkspace skus={skus} watch={watch.hits} watchError={watch.error} scanned={watch.scanned} aiOn={aiEnabled()} />;
}

import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import RecallStudio from "@/components/analytics/RecallStudio";
import { getAnalyticsData } from "@/lib/analytics";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Analytics · Recall Desk" };

export default function AnalyticsPage() {
  return (
    // Full-bleed: Studio needs the whole width, not the 6xl content column.
    <div className="relative left-1/2 -my-8 h-[calc(100dvh-57px)] w-screen -translate-x-1/2">
      <Suspense fallback={<div className="h-full bg-surface motion-safe:animate-pulse" />}>
        <Workspace />
      </Suspense>
    </div>
  );
}

async function Workspace() {
  // Live data from the ledger: render per request.
  await connection();
  const data = getAnalyticsData(getDb());
  return <RecallStudio data={data} licenseKey={process.env.AG_STUDIO} aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)} />;
}

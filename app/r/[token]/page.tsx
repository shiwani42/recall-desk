import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import RemedyChooser, { type RemedyOption } from "@/components/RemedyChooser";
import { Skeleton, fmtDate } from "@/components/ui";
import { eq } from "drizzle-orm";
import { Alternatives } from "@/components/MarketCheck";
import { channel3Enabled, safeAlternatives } from "@/lib/channel3";
import { getDb, t } from "@/lib/db";
import type { Remedy, ShipAddress } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { caseByToken } from "@/lib/recalls/queries";
import { replacementUnitsLeft } from "@/lib/recalls/execute";

export const metadata = { title: "Product safety recall", robots: { index: false } };

export default function BuyerRecallPage({ params }: PageProps<"/r/[token]">) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
      <Suspense fallback={<Skeleton rows={5} />}>
        <BuyerContent params={params} />
      </Suspense>
    </main>
  );
}

const addr = (a?: ShipAddress | null) => (a ? [a.line1, a.city, a.state, a.postalCode].filter(Boolean).join(", ") : "your address on file");

async function BuyerContent({ params }: { params: PageProps<"/r/[token]">["params"] }) {
  const { token } = await params;
  await connection(); // DB reads are synchronous: opt into per-request rendering
  const db = getDb();
  const row = caseByToken(db, token);
  if (!row) notFound();
  const { c, sale, item, recall } = row;
  const amount = formatMoney(c.refundAmountCents, sale.currency);

  const stockLeft = replacementUnitsLeft(db, recall.id, recall.replacementStock, c.id);
  const DETAILS: Record<Remedy, RemedyOption> = {
    refund: {
      remedy: "refund",
      title: `Refund ${amount}`,
      detail:
        c.refundRail === "paypal_refund"
          ? "Refunded to your original PayPal payment, usually within minutes."
          : `Sent to your PayPal account (${sale.buyerEmail}) as a payment.`,
    },
    replace: {
      remedy: "replace",
      title: "Free replacement",
      detail: `A new, fixed unit shipped to ${addr(sale.shipAddress)}.`,
      disabled: stockLeft < c.quantity ? "Replacements are currently out of stock." : undefined,
    },
    repair: { remedy: "repair", title: "Free repair kit", detail: `Shipped to ${addr(sale.shipAddress)}. Keep your product.` },
  };
  const done = c.status === "resolved" || c.status === "processing" || (c.status === "remedy_selected" && c.chosenRemedy !== "refund");

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-danger/30 bg-danger-soft p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-danger">Safety recall · {recall.id}</p>
        <h1 className="mt-1 text-xl font-semibold">{recall.title}</h1>
        <p className="mt-2 text-sm">{recall.hazard}</p>
        {recall.instructions && <p className="mt-3 text-sm font-semibold">{recall.instructions}</p>}
      </div>

      <div className="rounded-xl border border-line bg-surface p-5 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Your purchase</p>
        <p className="mt-1 font-medium">{c.quantity}× {item.name}</p>
        <p className="text-muted">
          Bought {fmtDate(sale.capturedAt)}
          {sale.captureId && <> · PayPal transaction <span className="font-mono">{sale.captureId}</span></>}
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-5">
        {done ? (
          <Resolved remedy={c.chosenRemedy!} status={c.status} amount={amount} rail={c.resolution?.rail} shipTo={addr(sale.shipAddress)} note={c.resolution?.note} />
        ) : (
          <>
            <h2 className="mb-1 font-semibold">Choose your remedy</h2>
            <p className="mb-4 text-sm text-muted">It&apos;s free. Pick whichever works best for you.</p>
            {c.status === "failed" && (
              <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">Our last attempt didn&apos;t go through. Please try again or pick another option.</p>
            )}
            <RemedyChooser token={token} options={recall.remedies.map((r) => DETAILS[r])} recommended={c.recommendedRemedy} />
          </>
        )}
      </div>
      {(c.chosenRemedy ?? c.recommendedRemedy) === "refund" && (
        <Suspense fallback={null}>
          <BuyerAlternatives sku={item.sku} />
        </Suspense>
      )}
      <p className="text-center text-xs text-muted">Sent because this purchase was made with PayPal. Questions? Reply to the recall email.</p>
    </div>
  );
}

function Resolved({ remedy, status, amount, rail, shipTo, note }: { remedy: Remedy; status: string; amount: string; rail?: string; shipTo: string; note?: string }) {
  const text =
    remedy === "refund"
      ? rail === "payout"
        ? status === "resolved"
          ? `${amount} has been paid into your PayPal account.`
          : `${amount} is on its way to your PayPal account. If you don't have one yet, PayPal will email you a link to claim it.`
        : status === "resolved"
          ? `${amount} has been refunded to your original PayPal payment.`
          : `Your ${amount} refund is being processed by PayPal.`
      : status === "resolved"
        ? `Your ${remedy === "replace" ? "replacement" : "repair kit"} has shipped.${note ? ` ${note}.` : ""}`
        : `Your ${remedy === "replace" ? "replacement" : "repair kit"} will ship to ${shipTo}. We'll email tracking when it's on the way.`;
  return (
    <div className="text-center">
      <p aria-hidden className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-ok-soft text-lg text-ok">✓</p>
      <p className="mt-2 font-semibold">You&apos;re all set</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
    </div>
  );
}

// Channel3: comparable products from other brands, in stock now, for buyers taking a refund.
async function BuyerAlternatives({ sku }: { sku: string }) {
  if (!channel3Enabled()) return null;
  const product = getDb().select().from(t.products).where(eq(t.products.sku, sku)).get();
  if (!product) return null;
  const items = await safeAlternatives(product).catch(() => []);
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <h2 className="font-semibold">Need a replacement now?</h2>
      <p className="text-sm text-muted">Similar products from other brands, in stock at these stores today.</p>
      <Alternatives items={items} />
    </div>
  );
}

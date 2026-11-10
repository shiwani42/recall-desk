"use client";

import { useState } from "react";
import { PayPalOneTimePaymentButton, type OnApproveDataOneTimePayments } from "@paypal/react-paypal-js/sdk-v6";
import { captureOrder, createOrder, type CaptureSummary } from "@/app/actions";

type State =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "cancelled" }
  | { status: "paid"; summary: CaptureSummary };

export default function PayPalCheckout({ sku }: { sku: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  if (state.status === "paid") {
    const { summary } = state;
    return (
      <div role="status" className="rounded-lg bg-ok-soft p-3 text-sm text-ok">
        <p className="font-semibold">✓ Paid {summary.amount} {summary.currency}</p>
        <p className="font-mono text-xs opacity-80">capture {summary.captureId} · recorded in ledger</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <PayPalOneTimePaymentButton
        presentationMode="auto"
        createOrder={async () => {
          setState({ status: "idle" });
          const res = await createOrder(sku);
          if (!res.ok) throw new Error(res.error);
          return { orderId: res.data.id };
        }}
        onApprove={async ({ orderId }: OnApproveDataOneTimePayments) => {
          const res = await captureOrder(orderId);
          setState(res.ok ? { status: "paid", summary: res.data } : { status: "error", message: res.error });
        }}
        onCancel={() => setState({ status: "cancelled" })}
        onError={(err) => {
          console.error("[paypal] button error:", err);
          setState({ status: "error", message: err.message || "Something went wrong" });
        }}
      />
      {state.status === "cancelled" && <p className="text-sm text-muted">Payment cancelled. No money moved.</p>}
      {state.status === "error" && <p role="alert" className="text-sm text-danger">{state.message}</p>}
    </div>
  );
}

"use client";

import { PayPalProvider } from "@paypal/react-paypal-js/sdk-v6";

const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const environment =
  process.env.NEXT_PUBLIC_PAYPAL_ENVIRONMENT === "production" ? "production" : "sandbox";

// Mount ONE provider high in the tree; it loads the v6 SDK script once and
// shares it with every PayPal button below it.
export default function PayPalProviders({ children }: { children: React.ReactNode }) {
  if (!clientId) {
    return (
      <div className="rounded-lg bg-warn-soft p-4 text-sm text-warn">
        <strong>PayPal isn&apos;t configured.</strong> Copy <code>.env.example</code> to{" "}
        <code>.env.local</code> and add your Sandbox Client ID and Secret from{" "}
        <a className="underline" href="https://developer.paypal.com/dashboard/applications/sandbox">
          developer.paypal.com
        </a>
        .
      </div>
    );
  }

  return (
    <PayPalProvider
      clientId={clientId}
      environment={environment}
      components={["paypal-payments"]}
      pageType="checkout"
    >
      {children}
    </PayPalProvider>
  );
}

import { desc } from "drizzle-orm";
import { connection } from "next/server";
import { Suspense } from "react";
import Linkified from "@/components/Linkified";
import RetryOutbox from "@/components/RetryOutbox";
import { Badge, Card, Skeleton, type Tone } from "@/components/ui";
import { getDb, t } from "@/lib/db";
import { emailConfigured } from "@/lib/email";

export default function OutboxPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-medium tracking-tight">Outbox</h1>
        <p className="mt-1 text-sm text-muted">Every email sent to buyers: recall notices and status updates.</p>
      </div>
      <Suspense fallback={<Skeleton rows={5} />}>
        <Messages />
      </Suspense>
    </div>
  );
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  sent: { label: "Sent", tone: "ok" },
  logged: { label: "Logged only", tone: "neutral" },
  queued: { label: "Queued", tone: "accent" },
  failed: { label: "Failed", tone: "danger" },
};

async function Messages() {
  await connection();
  const msgs = getDb().select().from(t.outbox).orderBy(desc(t.outbox.id)).all();
  const redirect = process.env.EMAIL_REDIRECT_TO;
  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
        <p>
          {emailConfigured() ? (
            <>
              <Badge tone="ok">SMTP connected</Badge>{" "}
              {redirect ? <>Demo mode: all email is redirected to <strong>{redirect}</strong>.</> : "Emails are delivered to buyers."}
            </>
          ) : (
            <>
              <Badge>No SMTP</Badge> Emails are logged here but not delivered. Set <code className="font-mono">SMTP_URL</code> in{" "}
              <code className="font-mono">.env.local</code> to send them.
            </>
          )}
        </p>
        <RetryOutbox failed={msgs.filter((m) => m.status === "failed").length} />
      </Card>
      {msgs.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">No emails yet. Open a recall and click “Notify buyers”.</Card>
      ) : (
        <div className="space-y-3">
          {msgs.map((m) => (
            <details key={m.id} className="rounded-[20px] bg-surface dark:border dark:border-line">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 p-4">
                <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>
                <Badge tone={m.kind === "notice" ? "danger" : "accent"}>{m.kind === "notice" ? "Recall notice" : "Update"}</Badge>
                <span className="font-medium">{m.to}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-muted">{m.subject}</span>
                <span className="text-xs text-muted">{m.createdAt.toLocaleString("en-US")}</span>
              </summary>
              <div className="border-t border-line p-4 text-sm">
                {m.deliveredTo && m.deliveredTo !== m.to && <p className="mb-2 text-xs text-muted">Delivered to {m.deliveredTo} (redirect)</p>}
                {m.error && <p className="mb-2 rounded bg-danger-soft px-2 py-1 text-xs text-danger">{m.error}</p>}
                <pre className="whitespace-pre-wrap break-words font-sans">
                  <Linkified text={m.body} />
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}
    </>
  );
}

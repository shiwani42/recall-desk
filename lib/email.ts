import nodemailer, { type Transporter } from "nodemailer";

// SMTP delivery. Works with any provider: set SMTP_URL, e.g.
//   smtps://user:app-password@smtp.gmail.com:465
//   smtp://resend:re_xxx@smtp.resend.com:587
// Without SMTP_URL, messages are only logged to the outbox.

export type Mail = { to: string; subject: string; text: string; html?: string };
export type DeliveryResult =
  | { status: "sent"; deliveredTo: string; providerId: string }
  | { status: "logged"; deliveredTo: null }
  | { status: "failed"; deliveredTo: string; error: string };

let transport: Transporter | null | undefined;

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL);
}

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  transport = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  return transport;
}

// For tests: swap the transport (e.g. nodemailer's jsonTransport).
export function setTransportForTests(t: Transporter | null) {
  transport = t;
}

export async function deliver(mail: Mail): Promise<DeliveryResult> {
  const t = getTransport();
  if (!t) return { status: "logged", deliveredTo: null };

  // Demo safety: route every email to one inbox instead of real buyers.
  const redirect = process.env.EMAIL_REDIRECT_TO;
  const to = redirect || mail.to;
  const subject = redirect ? `[to ${mail.to}] ${mail.subject}` : mail.subject;
  try {
    const info = await t.sendMail({
      from: process.env.EMAIL_FROM ?? "Recall Desk <recalls@localhost>",
      to,
      subject,
      text: mail.text,
      html: mail.html,
    });
    return { status: "sent", deliveredTo: to, providerId: String(info.messageId ?? "") };
  } catch (err) {
    return { status: "failed", deliveredTo: to, error: err instanceof Error ? err.message : String(err) };
  }
}

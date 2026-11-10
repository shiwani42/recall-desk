// Email content for buyers. Plain text is the source of truth; HTML is the same content, styled.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type Block = { kind: "p"; text: string } | { kind: "alert"; title: string; lines: string[] } | { kind: "button"; label: string; url: string } | { kind: "small"; text: string };

export function render(blocks: Block[]): { text: string; html: string } {
  const text = blocks
    .map((b) =>
      b.kind === "alert" ? [b.title.toUpperCase(), ...b.lines].join("\n") : b.kind === "button" ? `${b.label}:\n${b.url}` : b.text,
    )
    .join("\n\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f4f6;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e4e4e9">
<tr><td style="padding:28px">
${blocks
  .map((b) => {
    if (b.kind === "alert")
      return `<div style="background:#fdecea;border:1px solid #f3c4c0;border-radius:10px;padding:16px;margin:0 0 18px">
<div style="font-size:12px;font-weight:700;letter-spacing:.04em;color:#c4231b;text-transform:uppercase">${esc(b.title)}</div>
${b.lines.map((l) => `<p style="margin:8px 0 0;font-size:15px;line-height:1.5">${esc(l)}</p>`).join("")}</div>`;
    if (b.kind === "button")
      return `<p style="margin:22px 0"><a href="${esc(b.url)}" style="display:inline-block;background:#0b5fd6;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${esc(b.label)}</a></p>`;
    if (b.kind === "small") return `<p style="margin:18px 0 0;font-size:12px;color:#6b6b76">${esc(b.text)}</p>`;
    return `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${esc(b.text)}</p>`;
  })
  .join("\n")}
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}


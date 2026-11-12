// Splits plain text into text and http(s) link segments, so an email body (plain text) can be shown
// with its links clickable, e.g. the buyer's private recall link in the Outbox.

export type Segment = { type: "text" | "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;
// Punctuation that ends a sentence rather than a URL.
const TRAILING = /[.,;:!?)\]]+$/;

export function splitLinks(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const url = m[0].replace(TRAILING, "");
    if (!url) continue;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    out.push({ type: "link", value: url });
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

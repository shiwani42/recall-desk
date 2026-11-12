import { splitLinks } from "@/lib/linkify";

/** Plain text with its http(s) URLs as links (they open in a new tab, so the console stays put). */
export default function Linkified({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((s, i) =>
        s.type === "link" ? (
          // `relative` keeps the .sr-only span inside the link instead of at the page edge.
          <a key={i} href={s.value} target="_blank" rel="noreferrer" className="relative font-medium underline underline-offset-2 hover:opacity-80">
            {s.value}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          s.value
        ),
      )}
    </>
  );
}

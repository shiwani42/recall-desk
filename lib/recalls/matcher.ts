import type { Notice } from "@/lib/cpsc";

export type CatalogItem = { sku: string; name: string; description: string; brand: string | null; model: string | null; upc: string | null };
export type Match = { sku: string; score: number; confidence: "strong" | "possible"; reasons: string[] };

const alnum = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const STOP = new Set(["the", "and", "with", "for", "from", "kit", "set", "pack", "inch", "new", "recall", "recalls", "due", "risk", "hazard", "hazards", "model", "models", "sold", "black", "white"]);
const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/\d/.test(w))
      .map((w) => w.replace(/(ies)$/, "y").replace(/(?<!s)s$/, "")),
  );

// Deterministic, explainable matching. Product type alone is never enough:
// "space heater" ≠ the recalled "DREO DR-HSH015 space heater".
export function matchNotice(notice: Notice, catalog: CatalogItem[]): Match[] {
  const noticeText = alnum(notice.text);
  const noticeWords = tokens(`${notice.title} ${notice.products.join(" ")}`);
  const brandsText = ` ${[...notice.brands, notice.title].join(" ").toLowerCase()} `;

  const out: Match[] = [];
  for (const p of catalog) {
    const reasons: string[] = [];
    let score = 0;

    if (p.upc && notice.upcs.includes(p.upc.replace(/\D/g, ""))) {
      score = 1;
      reasons.push(`UPC ${p.upc} is listed in the recall`);
    }
    const model = p.model ? alnum(p.model) : "";
    if (model.length >= 4 && noticeText.includes(model)) {
      score = Math.max(score, 0.95);
      reasons.push(`Model ${p.model} is named in the recall`);
    }

    const brandHit = Boolean(p.brand && p.brand.length >= 2 && new RegExp(`\\b${p.brand.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(brandsText));
    // Product-type overlap, excluding brand words (otherwise "DREO fan" would look like "DREO heater").
    const brandWords = tokens([p.brand ?? "", ...notice.brands].join(" "));
    const shared = [...tokens(`${p.name} ${p.description}`)].filter((w) => noticeWords.has(w) && !brandWords.has(w));
    if (brandHit) reasons.push(`Brand ${p.brand} matches`);
    if (shared.length) reasons.push(`Same kind of product (${shared.slice(0, 3).join(", ")})`);
    if (score < 0.9 && brandHit && shared.length) score = Math.max(score, 0.6);

    if (score >= 0.5) out.push({ sku: p.sku, score, confidence: score >= 0.9 ? "strong" : "possible", reasons });
  }
  return out.sort((a, b) => b.score - a.score);
}

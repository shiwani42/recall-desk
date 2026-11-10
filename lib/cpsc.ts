import type { Remedy, Severity } from "@/lib/db/schema";

// US Consumer Product Safety Commission public recalls API (no key needed).
// https://www.saferproducts.gov/RestWebServices/Recall?format=json
const API = "https://www.saferproducts.gov/RestWebServices/Recall";

type Named = { Name?: string };
type CpscRecall = {
  RecallNumber: string;
  RecallDate: string;
  Title: string;
  Description: string;
  URL: string;
  ConsumerContact?: string;
  Products?: { Name?: string; Description?: string; Model?: string; Type?: string; NumberOfUnits?: string }[];
  Hazards?: Named[];
  Remedies?: Named[];
  RemedyOptions?: { Option?: string }[];
  Injuries?: Named[];
  Manufacturers?: Named[];
  Importers?: Named[];
  Distributors?: Named[];
  Retailers?: Named[];
  ProductUPCs?: { UPC?: string }[];
  Images?: { URL?: string }[];
};

// A recall notice from any source, normalized.
export type Notice = {
  source: "cpsc";
  id: string;
  date: string;
  title: string;
  url: string;
  products: string[];
  brands: string[];
  upcs: string[];
  hazard: string;
  instructions: string;
  remedies: Remedy[];
  severity: Severity;
  injuries: string;
  units: string;
  soldAt: string;
  imageUrl?: string;
  /** Everything searchable, for matching against the catalog. */
  text: string;
};

const HIGH_RISK = /\b(fire|burn|death|deaths|died|choking|suffocat\w*|strangulat\w*|electrocut\w*|electric shock|entrapment|tip-?over|lacerat\w*|poison\w*|carbon monoxide|drown\w*|serious injury|fall hazard|ingestion|explo\w*)\b/i;

export function severityFor(text: string): Severity {
  return HIGH_RISK.test(text) ? "high" : "medium";
}

const firstSentence = (s = "") => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const names = (xs?: Named[]) => (xs ?? []).map((x) => x.Name?.trim()).filter((x): x is string => Boolean(x));

export function normalizeCpsc(r: CpscRecall): Notice {
  const hazard = names(r.Hazards).join(" ") || firstSentence(r.Description);
  const remedies = [
    ...new Set(
      (r.RemedyOptions ?? [])
        .map((o) => o.Option?.toLowerCase())
        .map((o) => (o === "refund" ? "refund" : o === "replace" ? "replace" : o === "repair" ? "repair" : null))
        .filter((o): o is Remedy => o !== null),
    ),
  ];
  // "DREO Recalls DR-HSH015 Space Heaters…" → "DREO"
  const titleBrand = r.Title.match(/^(.+?)\s+Recalls?\b/i)?.[1];
  const brands = [...new Set([...(titleBrand ? [titleBrand] : []), ...names(r.Manufacturers), ...names(r.Importers), ...names(r.Distributors)])];
  const products = (r.Products ?? []).map((p) => [p.Name, p.Model].filter(Boolean).join(" ")).filter(Boolean);
  const upcs = (r.ProductUPCs ?? []).map((u) => u.UPC?.replace(/\D/g, "")).filter((u): u is string => Boolean(u));
  const injuries = names(r.Injuries).join(" ");

  return {
    source: "cpsc",
    id: r.RecallNumber,
    date: r.RecallDate.slice(0, 10),
    title: r.Title,
    url: r.URL,
    products,
    brands,
    upcs,
    hazard,
    instructions: firstSentence(names(r.Remedies)[0]),
    remedies: remedies.length ? remedies : ["refund"],
    severity: severityFor(`${r.Title} ${hazard} ${injuries}`),
    injuries,
    units: (r.Products ?? []).map((p) => p.NumberOfUnits).filter(Boolean).join("; "),
    soldAt: names(r.Retailers).join(" ").replace(/^Sold At:\s*/i, ""),
    imageUrl: r.Images?.[0]?.URL,
    text: [r.Title, r.Description, ...products, ...(r.Products ?? []).map((p) => p.Description ?? "")].join(" \n"),
  };
}

const cache = new Map<string, { at: number; data: Notice[] }>();
const TTL_MS = 60 * 60 * 1000;

async function query(params: Record<string, string>): Promise<Notice[]> {
  const url = `${API}?${new URLSearchParams({ format: "json", ...params })}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`CPSC API ${res.status}`);
  const data = ((await res.json()) as CpscRecall[]).map(normalizeCpsc).sort((a, b) => b.date.localeCompare(a.date));
  cache.set(url, { at: Date.now(), data });
  return data;
}

export function recentRecalls(days = 90) {
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  return query({ RecallDateStart: since });
}

export async function searchRecalls(q: string) {
  const [byTitle, byProduct] = await Promise.all([query({ RecallTitle: q }), query({ ProductName: q })]);
  const seen = new Set<string>();
  return [...byTitle, ...byProduct].filter((n) => !seen.has(n.id) && seen.add(n.id)).slice(0, 25);
}

export async function getRecall(recallNumber: string): Promise<Notice | null> {
  const r = await query({ RecallNumber: recallNumber });
  return r[0] ?? null;
}

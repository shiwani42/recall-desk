import { TransactionSearchController, type TransactionDetails } from "@paypal/paypal-server-sdk";
import { getPayPalClient } from "./client";

let ctrl: TransactionSearchController | undefined;
const controller = () => (ctrl ??= new TransactionSearchController(getPayPalClient()));

// PayPal limits each search to a 31-day window, and keeps 3 years of history.
const WINDOW_MS = 31 * 864e5;
export const MAX_HISTORY_DAYS = 3 * 365;

export type SearchResult = { transactions: TransactionDetails[]; lastRefreshed: string | null };

// Fetch every transaction (with cart / payer / shipping detail) between two dates.
// 31-day windows are fetched in parallel (a few at a time to stay polite to the API).
export async function searchAllTransactions(from: Date, to: Date, concurrency = 6): Promise<SearchResult> {
  const windows: [number, number][] = [];
  for (let start = from.getTime(); start < to.getTime(); start += WINDOW_MS) {
    windows.push([start, Math.min(start + WINDOW_MS - 1000, to.getTime())]);
  }

  const results: { transactions: TransactionDetails[]; lastRefreshed: string | null }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < windows.length) {
      const i = next++;
      results[i] = await searchWindow(...windows[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
  return {
    transactions: results.flatMap((r) => r.transactions),
    lastRefreshed: results.find((r) => r.lastRefreshed)?.lastRefreshed ?? null,
  };
}

async function searchWindow(start: number, end: number) {
  const transactions: TransactionDetails[] = [];
  let lastRefreshed: string | null = null;
  for (let page = 1; ; page++) {
    const { result } = await controller().searchTransactions({
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
      fields: "all",
      pageSize: 500,
      page,
    });
    transactions.push(...(result.transactionDetails ?? []));
    lastRefreshed ??= result.lastRefreshedDatetime ?? null;
    if (!result.totalPages || page >= result.totalPages) break;
  }
  return { transactions, lastRefreshed };
}

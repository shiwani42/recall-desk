// What the boot seed did, written next to the database so /api/health can show it. On a host with no
// log access (or no time to read logs) this answers "why are there fewer sandbox sales than expected?".
// It holds counts and PayPal error codes only, never credentials.

import fs from "node:fs";
import path from "node:path";

export type SeedReport = {
  at: string;
  /** Real card-funded sandbox sales (PayPal captures). */
  sandboxSales: { captured: number; attempted: number; skipped: number; errors: string[] };
  /** Sandbox payouts for the seeded past recall. */
  payouts: { sent: number; failed: number; outOfFunds: boolean };
};

const reportFile = () => path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "recall.db")), "seed-report.json");

export function writeSeedReport(report: SeedReport) {
  try {
    fs.writeFileSync(reportFile(), JSON.stringify(report));
  } catch {
    // Reporting must never stop the seed (or the boot that follows it).
  }
}

export function readSeedReport(): SeedReport | null {
  try {
    return JSON.parse(fs.readFileSync(reportFile(), "utf8")) as SeedReport;
  } catch {
    return null;
  }
}

/**
 * When PayPal declines every test card for this many orders in a row, the sandbox is refusing cards
 * (it does after heavy use). More attempts only add load and slow the boot, so the seed stops.
 */
export const MAX_FAILED_ORDERS_IN_A_ROW = 2;
export const shouldStopCapturing = (failedInARow: number) => failedInARow >= MAX_FAILED_ORDERS_IN_A_ROW;

/** Card errors that mean "try the next test card" rather than "something is wrong". */
export const isCardDecline = (message: string) => /PAYER_CANNOT_PAY|INSTRUMENT_DECLINED/.test(message);

/** Keep a few distinct, short error messages for the report. */
export function addError(errors: string[], message: string, max = 3) {
  const m = message.slice(0, 200);
  if (errors.length < max && !errors.includes(m)) errors.push(m);
}

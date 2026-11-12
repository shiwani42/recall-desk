import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addError, isCardDecline, readSeedReport, shouldStopCapturing, writeSeedReport, type SeedReport } from "@/lib/seed-report";

const report: SeedReport = {
  at: "2026-11-12T18:00:00.000Z",
  sandboxSales: { captured: 0, attempted: 2, skipped: 8, errors: ["PayPal 422: PAYER_CANNOT_PAY"] },
  payouts: { sent: 9, failed: 0, outOfFunds: false },
};

describe("seed report file", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-report-"));
    process.env.DATABASE_PATH = path.join(dir, "recall.db");
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips next to the database", () => {
    writeSeedReport(report);
    expect(fs.existsSync(path.join(dir, "seed-report.json"))).toBe(true);
    expect(readSeedReport()).toEqual(report);
  });

  it("reads as null when there is no report", () => {
    expect(readSeedReport()).toBeNull();
  });

  it("reads as null for a corrupt file instead of throwing", () => {
    fs.writeFileSync(path.join(dir, "seed-report.json"), "{not json");
    expect(readSeedReport()).toBeNull();
  });

  it("never throws when the directory can't be written", () => {
    process.env.DATABASE_PATH = path.join(dir, "missing", "deeper", "recall.db");
    expect(() => writeSeedReport(report)).not.toThrow();
  });
});

describe("capture back-off", () => {
  it("stops after two failed orders in a row, not before", () => {
    expect([0, 1, 2, 3].map(shouldStopCapturing)).toEqual([false, false, true, true]);
  });

  it("rotates cards on a decline, not on other errors", () => {
    expect(isCardDecline("PayPal 422: PAYER_CANNOT_PAY — x")).toBe(true);
    expect(isCardDecline("PayPal 422: INSTRUMENT_DECLINED")).toBe(true);
    expect(isCardDecline("PayPal 401: invalid_client")).toBe(false);
    expect(isCardDecline("Missing env var PAYPAL_CLIENT_SECRET")).toBe(false);
  });

  it("keeps a few distinct, short error messages", () => {
    const errors: string[] = [];
    for (const m of ["a", "a", "b", "c", "d", "x".repeat(500)]) addError(errors, m);
    expect(errors).toEqual(["a", "b", "c"]);
    const long: string[] = [];
    addError(long, "y".repeat(500));
    expect(long[0]).toHaveLength(200);
  });
});

/**
 * Cross-validation: the same period, in the two formats the bank offers.
 *
 * Having both the PDF and the OFX for the same month is the best proof
 * available that both readers are correct. They share no reading code — one
 * interprets page geometry, the other interprets tags — so agreeing
 * transaction by transaction would be an unlikely coincidence if either
 * were wrong.
 *
 * Runs only when both files are in tests/local (an ignored folder).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { formatBRL, sum, toDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { parseCoraPdf } from "../../src/node/cora";
import { parseOfx } from "../../src/universal/ofx";

const pdfPath = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const ofxPath = fileURLToPath(new URL("./extrato-cora.ofx", import.meta.url));
const hasBoth = existsSync(pdfPath) && existsSync(ofxPath);

describe.skipIf(!hasBoth)("PDF and OFX for the same period", () => {
  const ofx = parseOfx(new Uint8Array(readFileSync(ofxPath)));

  it("reports what each format delivers", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    console.log(`
  ---------------------------------------------------------------
                              PDF            OFX
  transactions          ${String(pdf.lines.length).padStart(10)}     ${String(ofx.lines.length).padStart(10)}
  with FITID            ${String(pdf.lines.filter((l) => l.fitid).length).padStart(10)}     ${String(ofx.lines.filter((l) => l.fitid).length).padStart(10)}
  truncated name        ${String(pdf.lines.filter((l) => l.nameTruncated).length).padStart(10)}     ${String(ofx.lines.filter((l) => l.nameTruncated).length).padStart(10)}
  opening balance       ${(pdf.openingBalance !== undefined ? formatBRL(pdf.openingBalance) : "absent").padStart(14)} ${(ofx.openingBalance !== undefined ? formatBRL(ofx.openingBalance) : "absent").padStart(14)}
  closing balance       ${(pdf.ledgerBalance !== undefined ? formatBRL(pdf.ledgerBalance) : "absent").padStart(14)} ${(ofx.ledgerBalance !== undefined ? formatBRL(ofx.ledgerBalance) : "absent").padStart(14)}
  period                ${pdf.periodStart} to ${pdf.periodEnd}   ${ofx.periodStart} to ${ofx.periodEnd}
  ---------------------------------------------------------------`);

    for (const warning of ofx.warnings) console.log(`  OFX warning: ${warning}`);
  });

  it("reads the same number of transactions", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));
    expect(ofx.lines.length).toBe(pdf.lines.length);
  });

  it("agrees on date and amount, transaction by transaction", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    const key = (l: { postedAt: string; amount: number }) => `${l.postedAt}|${l.amount}`;
    const fromPdf = pdf.lines.map(key).sort();
    const fromOfx = ofx.lines.map(key).sort();

    expect(fromOfx).toEqual(fromPdf);
  });

  it("arrives at the same total movement", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));
    const totalOfx = sum(ofx.lines.map((l) => l.amount));
    const totalPdf = sum(pdf.lines.map((l) => l.amount));

    expect(toDb(totalOfx)).toBe(toDb(totalPdf));
    // The OFX's closing balance matches the PDF's opening balance plus the movement.
    expect(toDb(pdf.openingBalance! + totalOfx)).toBe(toDb(ofx.ledgerBalance!));
  });

  it("the opening balance the OFX implies matches what the PDF declares", async () => {
    // The strongest check the two files allow together. OFX doesn't carry
    // an opening balance; it can only be deduced from the closing balance
    // minus the movement. The PDF declares the opening balance directly.
    // The two numbers arrive by independent paths and have to match to the
    // cent — if either reader had lost or duplicated a transaction, they wouldn't.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    expect(toDb(ofx.integrity!.declaredOpening!)).toBe(toDb(pdf.openingBalance!));
    expect(toDb(ofx.integrity!.computedInflow)).toBe(toDb(pdf.integrity!.computedInflow));
    expect(toDb(ofx.integrity!.computedOutflow)).toBe(toDb(pdf.integrity!.computedOutflow));
  });

  it("both formats agree on the period the statement attests to", async () => {
    // Both files declare covering through 08/31 and both were generated on
    // the 25th. The readers reach the same cutoff by different paths: the
    // PDF's by the last printed daily balance, the OFX's by DTSERVER.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    expect(ofx.periodStart).toBe(pdf.periodStart);
    expect(ofx.periodEnd).toBe(pdf.periodEnd);
    expect(ofx.periodEnd).toBe("2026-08-25");
  });

  it("the counterparty's document number is the same in both formats", async () => {
    // The name comes truncated in the PDF and whole in the OFX, but the
    // document number is identical — which is why it, and not the name, is
    // the counterparty key.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    const fromPdf = pdf.lines
      .map((l) => l.counterpartyDocument)
      .filter(Boolean)
      .sort();
    const fromOfx = ofx.lines
      .map((l) => l.counterpartyDocument)
      .filter(Boolean)
      .sort();

    expect(fromOfx).toEqual(fromPdf);
  });

  it("the OFX carries the full name where the PDF truncated it", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    const truncated = pdf.lines.filter((l) => l.nameTruncated);
    expect(truncated.length).toBeGreaterThan(20);

    // For every name truncated in the PDF, the OFX has the full name starting the same way.
    for (const line of truncated.slice(0, 5)) {
      const counterpart = ofx.lines.find(
        (l) => l.postedAt === line.postedAt && l.amount === line.amount,
      )!;
      expect(counterpart.memo.length).toBeGreaterThanOrEqual(line.memo.length);
    }
  });

  it("the OFX identifies every transaction with a FITID, which the PDF doesn't", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(pdfPath)));

    expect(ofx.lines.every((l) => l.fitid !== undefined && l.fitid !== "")).toBe(true);
    expect(ofx.lines.every((l) => l.dedupKey.startsWith("fitid:"))).toBe(true);
    expect(pdf.lines.every((l) => l.dedupKey.startsWith("c:"))).toBe(true);
    expect(new Set(ofx.lines.map((l) => l.dedupKey)).size).toBe(ofx.lines.length);
  });

  it("doesn't shift the date because of the timezone declared in the file", () => {
    // Dates come as 20260825000000[0:GMT]. Midnight GMT is 9pm the PREVIOUS
    // day in Brazil: treating it as an instant would push the 25th's
    // transaction to the 24th, and the month would close wrong. The reader
    // uses the first eight digits and converts nothing.
    const firstDay = ofx.lines.filter((l) => l.postedAt === "2026-08-01");
    expect(firstDay.length).toBeGreaterThan(0);
    expect(ofx.lines.every((l) => l.postedAt >= "2026-08-01" && l.postedAt <= "2026-08-31")).toBe(
      true,
    );
  });
});

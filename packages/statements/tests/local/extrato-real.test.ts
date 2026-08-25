/**
 * Checks the reader against a real statement.
 *
 * Runs only when there's a PDF in tests/local (a folder ignored by git).
 * With no file, the tests declare themselves skipped — CI has no real
 * statement, and shouldn't.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { formatBRL } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { parseCoraPdf } from "../../src/node/cora";

const path = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const exists = existsSync(path);

describe.skipIf(!exists)("a real statement from Cora", () => {
  it("reads it, checks it against the declared totals and matches every daily balance", async () => {
    const statement = await parseCoraPdf(new Uint8Array(readFileSync(path)));
    const integrity = statement.integrity!;

    // Readable report: this is what you look at when the check fails.
    console.log(`\n  period .................. ${statement.periodStart} to ${statement.periodEnd}`);
    console.log(`  transactions read ....... ${statement.lines.length}`);
    console.log(`  declared opening balance  ${formatBRL(integrity.declaredOpening!)}`);
    console.log(
      `  inflow: declared ${formatBRL(integrity.declaredInflow!)} | read ${formatBRL(integrity.computedInflow)}`,
    );
    console.log(
      `  outflow: declared ${formatBRL(integrity.declaredOutflow!)} | read ${formatBRL(integrity.computedOutflow)}`,
    );
    console.log(
      `  closing balance: declared ${formatBRL(integrity.declaredClosing!)} | read ${formatBRL(integrity.computedClosing!)}`,
    );
    console.log(
      `  daily balances matched: ${integrity.dailyChecks.filter((c) => c.ok).length}/${integrity.dailyChecks.length}`,
    );
    for (const problem of integrity.problems) console.log(`  PROBLEM: ${problem}`);
    for (const warning of statement.warnings) console.log(`  warning: ${warning}`);

    expect(integrity.computedInflow).toBe(integrity.declaredInflow);
    expect(integrity.computedOutflow).toBe(integrity.declaredOutflow);
    expect(integrity.computedClosing).toBe(integrity.declaredClosing);
    expect(integrity.dailyChecks.every((check) => check.ok)).toBe(true);
    expect(integrity.problems).toEqual([]);
    expect(integrity.ok).toBe(true);
  });

  it("doesn't generate a repeated deduplication key", async () => {
    const statement = await parseCoraPdf(new Uint8Array(readFileSync(path)));
    const keys = new Set(statement.lines.map((line) => line.dedupKey));
    expect(keys.size).toBe(statement.lines.length);
  });

  it("delivers the transactions in chronological order", async () => {
    const statement = await parseCoraPdf(new Uint8Array(readFileSync(path)));
    const dates = statement.lines.map((line) => line.postedAt);
    expect(dates).toEqual([...dates].sort());
  });
});

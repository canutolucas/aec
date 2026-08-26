/**
 * Validation for the JSON payload the conciliacao client sends after parsing
 * a statement file (OFX/CSV in the browser, PDF via the server action).
 *
 * Kept out of `actions.ts` on purpose: that file has `"use server"` at the
 * top, and Next.js requires every export of a `"use server"` module to be an
 * async function — a plain, synchronous validator like `parsePayload`
 * couldn't live there and still be unit-testable (or, for that matter,
 * exported at all without breaking the build). Splitting it out also makes
 * the point clearer: this logic has no I/O and no framework dependency: it's
 * a pure function of a string, which is exactly what makes it worth testing
 * directly instead of only ever exercising it through a full import flow.
 */

import type { StatementSource } from "@aec/db";
import { type Cents, type IsoDate } from "@aec/domain";

export interface ImportedLine {
  readonly postedAt: IsoDate;
  readonly amount: Cents;
  readonly memo: string;
  readonly fitid?: string;
  readonly dedupKey: string;
}

export interface ImportPayload {
  readonly source: Extract<StatementSource, "ofx" | "csv" | "pdf">;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly ledgerBalance?: Cents;
  readonly ledgerBalanceDate?: IsoDate;
  readonly lines: readonly ImportedLine[];
}

export function isValidLineShape(line: ImportedLine): boolean {
  return (
    typeof line.postedAt === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(line.postedAt) &&
    Number.isSafeInteger(line.amount) &&
    typeof line.memo === "string" &&
    typeof line.dedupKey === "string" &&
    line.dedupKey.length > 0
  );
}

export function parsePayload(value: string): ImportPayload | null {
  try {
    const payload = JSON.parse(value) as ImportPayload;
    if (
      (payload.source !== "ofx" && payload.source !== "csv" && payload.source !== "pdf") ||
      !Array.isArray(payload.lines) ||
      payload.lines.length === 0 ||
      payload.lines.length > 10_000
    ) {
      return null;
    }

    if (!payload.lines.every(isValidLineShape)) return null;

    // A zero-amount line is malformed, not just uninteresting: statement_lines
    // has `check (amount <> 0)`, so inserting one would fail the whole batch
    // at the database. csv.ts already drops these before they get this far;
    // ofx.ts and node/cora.ts don't filter them (a $0.00 informational line
    // is rarer but not impossible in a real export), so the same drop
    // happens here — one stray zero-amount line shouldn't invalidate an
    // otherwise-good statement with hundreds of real transactions.
    const lines = payload.lines.filter((line) => line.amount !== 0);
    if (lines.length === 0) return null;

    return { ...payload, lines };
  } catch {
    return null;
  }
}

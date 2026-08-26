/**
 * Bridge between import and reconciliation.
 *
 * Universal entry point: OFX, CSV and the canonical types only. No `unpdf`
 * import reaches this file, which is what keeps the React Native bundle
 * from pulling in a Node-only dependency. The PDF reader lives in
 * `../node/index.ts` and re-exports everything here too, so the web app can
 * import from a single place.
 */

import type { StatementLine } from "@aec/domain";

import type { CanonicalStatement } from "./types";

export {
  type CsvMapping,
  detectDelimiter,
  type DetectedMapping,
  detectMapping,
  parseCsv,
  parseCsvDate,
  parseStatementCsv,
} from "./csv";
export * from "./dedup";
export { type CanonicalInvoice, parseNfse } from "./nfse";
export { decodeOfx, parseOfx, parseOfxAmount, parseOfxDate } from "./ofx";
export * from "./types";

/**
 * Prepares the statement lines for reconciliation.
 *
 * Before being saved, the lines don't have a database id yet. Their identity
 * at this point is the deduplication key, which is already unique within the
 * account — the same key the database later uses for its unique index. This
 * lets the system reconcile and show the result BEFORE writing anything,
 * which is how the import screen is meant to work: whoever is operating
 * reviews, and only then confirms.
 */
export function toMatchableLines(statement: CanonicalStatement): StatementLine[] {
  return statement.lines.map((line) => ({
    id: line.dedupKey,
    postedAt: line.postedAt,
    amount: line.amount,
    memo: line.memo,
  }));
}

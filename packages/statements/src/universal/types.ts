/**
 * Canonical statement format.
 *
 * OFX, CSV and, in the future, Open Finance are normalized to this shape
 * before anything else happens. The rest of the system — reconciliation,
 * deduplication, writing — only knows this format. A new source becomes a
 * new parser, and nothing else in the system changes.
 */

import type { Cents, IsoDate } from "@aec/domain";

export type StatementSource = "ofx" | "csv" | "pdf" | "open_finance";

export interface CanonicalLine {
  readonly postedAt: IsoDate;
  /** Signed: positive is an inflow, negative an outflow. */
  readonly amount: Cents;
  readonly memo: string;
  /** The bank's transaction identifier. Present in OFX, absent in CSV and PDF. */
  readonly fitid?: string;
  readonly checkNumber?: string;
  /** Counterparty name, when the statement carries it in its own field. */
  readonly counterpartyName?: string;
  /**
   * Counterparty CNPJ or CPF, digits only.
   *
   * Worth more than the name for identifying who it is: statements often
   * TRUNCATE the name, and the document number comes in full. It's the
   * stable key for matching the counterparty.
   */
  readonly counterpartyDocument?: string;
  /** True when the statement cut off the counterparty's name. */
  readonly nameTruncated?: boolean;
  /**
   * Deduplication key within the account. This is what guarantees that
   * reimporting a statement — whole or with an overlapping period — never
   * duplicates movement.
   */
  readonly dedupKey: string;
}

/**
 * Arithmetic check of what was read against what the statement declares.
 *
 * A statement carries totals and, in some formats, each day's balance.
 * Redoing that math and comparing is what prevents the worst failure mode of
 * a statement reader: reading it WRONG and not warning about it. A dropped
 * line or a misread amount would produce a plausible balance, and the
 * divergence would only show up at closing time.
 */
export interface DailyBalanceCheck {
  readonly date: IsoDate;
  readonly declared: Cents;
  readonly computed: Cents;
  readonly ok: boolean;
}

export interface StatementIntegrity {
  readonly declaredOpening?: Cents;
  readonly declaredClosing?: Cents;
  readonly declaredInflow?: Cents;
  readonly declaredOutflow?: Cents;
  readonly computedInflow: Cents;
  readonly computedOutflow: Cents;
  readonly computedClosing?: Cents;
  readonly dailyChecks: readonly DailyBalanceCheck[];
  /** False when any check failed. Importing like this is risky. */
  readonly ok: boolean;
  readonly problems: readonly string[];
}

export interface CanonicalStatement {
  readonly source: StatementSource;
  readonly bankId?: string;
  readonly accountId?: string;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  /**
   * Closing balance the bank itself reports in the file. This is what the
   * system proves the balance against — without it, reconciliation only
   * compares line by line and never asserts the total is correct.
   */
  readonly ledgerBalance?: Cents;
  readonly ledgerBalanceDate?: IsoDate;
  /** Balance on the day before the period, when the statement declares it. */
  readonly openingBalance?: Cents;
  readonly lines: readonly CanonicalLine[];
  /** Check against the declared totals, when the format provides them. */
  readonly integrity?: StatementIntegrity;
  /** Problems that don't block the import, but whoever's operating needs to know. */
  readonly warnings: readonly string[];
}

export class ImportError extends Error {}

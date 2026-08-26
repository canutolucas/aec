/**
 * Balance and running ledger.
 *
 * The balance is never read from a field: it is always rebuilt from the
 * account's opening balance plus its movement. A balance field updated on
 * every transaction is the number one source of drift in a financial
 * system — one forgotten write path is all it takes for the number to start
 * lying, with nothing to flag it.
 *
 * Pure functions: they take the transactions, return the numbers. No I/O, no
 * clock, no state. That's what makes this testable and auditable.
 */

import { compareDates, eachDay, type IsoDate } from "./dates";
import { type Cents, sum } from "./money";

/**
 * "previsto" | "realizado" mirror the `app.transaction_status` Postgres enum
 * in supabase/migrations, which this migration deliberately leaves
 * untouched — translating the literals here without also touching the
 * database would just move the bug to the boundary between the two.
 */
export type TransactionStatus = "previsto" | "realizado";

/** The minimum the balance calculation needs to know about a transaction. */
export interface BalanceEntry {
  readonly bookingDate: IsoDate;
  readonly amount: Cents;
  readonly status: TransactionStatus;
}

export interface AccountOpening {
  readonly openingBalance: Cents;
  readonly openingBalanceDate: IsoDate;
}

/** Which movement counts toward the balance: only what happened, or planned too. */
export type BalanceScope = "realizado" | "total";

function inScope(entry: BalanceEntry, scope: BalanceScope): boolean {
  return scope === "total" || entry.status === "realizado";
}

/**
 * Account balance on a given date, inclusive.
 *
 * Transactions before the opening balance date are ignored: the opening
 * balance already includes them, and summing them again would count the same
 * money twice. The database rejects such transactions on write; the rule is
 * repeated here because the calculation must hold up even against imported
 * historical data.
 */
export function balanceOn(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  date: IsoDate,
  scope: BalanceScope = "realizado",
): Cents {
  if (compareDates(date, opening.openingBalanceDate) < 0) {
    return 0;
  }

  const movement = entries.filter(
    (entry) =>
      inScope(entry, scope) &&
      compareDates(entry.bookingDate, opening.openingBalanceDate) >= 0 &&
      compareDates(entry.bookingDate, date) <= 0,
  );

  return opening.openingBalance + sum(movement.map((entry) => entry.amount));
}

/** A closing balance the bank itself declared, as of a specific date. */
export interface DeclaredBalance {
  readonly bankAccountId: string;
  readonly balance: Cents;
  readonly date: IsoDate;
}

export interface BalanceCheck {
  readonly bankAccountId: string;
  readonly declaredBalance: Cents;
  readonly declaredDate: IsoDate;
  readonly computedBalance: Cents;
  /** computedBalance - declaredBalance. Zero means the system's own math agrees with the bank. */
  readonly diff: Cents;
}

/**
 * Proves — or disproves — that the system's own ledger agrees with what the
 * bank's statement declared as of a given date.
 *
 * This is the reconciliation screen's balance-proof panel: importing a
 * statement and confirming a few pairings feels like progress, but it's
 * only proof the month closes clean when the running total matches the
 * bank's own number. `diff` is computed - declared on purpose (not the
 * other way around) so a positive diff always reads as "the system thinks
 * there's more money than the bank does" — a system that's missing an
 * outflow, or has an inflow it shouldn't.
 */
export function checkBalance(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  declared: DeclaredBalance,
): BalanceCheck {
  const computedBalance = balanceOn(opening, entries, declared.date);
  return {
    bankAccountId: declared.bankAccountId,
    declaredBalance: declared.balance,
    declaredDate: declared.date,
    computedBalance,
    diff: computedBalance - declared.balance,
  };
}

/** Balance considering all reported movement, with no date cutoff. */
export function currentBalance(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  scope: BalanceScope = "realizado",
): Cents {
  const relevant = entries.filter(
    (entry) =>
      inScope(entry, scope) && compareDates(entry.bookingDate, opening.openingBalanceDate) >= 0,
  );
  return opening.openingBalance + sum(relevant.map((entry) => entry.amount));
}

export interface DailyBalance {
  readonly date: IsoDate;
  readonly inflow: Cents;
  readonly outflow: Cents;
  readonly net: Cents;
  readonly balance: Cents;
  readonly entryCount: number;
}

/**
 * Day-by-day ledger with running balance.
 *
 * Returns EVERY day in the range, including the ones with no movement. This
 * is what lets the evolution chart and the projection read the balance on
 * any date, not just the days someone posted something.
 */
export function dailyBalances(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  from: IsoDate,
  to: IsoDate,
  scope: BalanceScope = "realizado",
): DailyBalance[] {
  const byDate = new Map<IsoDate, BalanceEntry[]>();
  for (const entry of entries) {
    if (!inScope(entry, scope)) continue;
    if (compareDates(entry.bookingDate, opening.openingBalanceDate) < 0) continue;
    const bucket = byDate.get(entry.bookingDate);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.bookingDate, [entry]);
    }
  }

  // Running balance up to the eve of the range, so the first row already
  // starts from the right balance instead of starting from zero.
  const start =
    compareDates(from, opening.openingBalanceDate) < 0 ? opening.openingBalanceDate : from;

  let running = balanceOn(opening, entries, previousDay(start), scope);

  return eachDay(start, to).map((date) => {
    const dayEntries = byDate.get(date) ?? [];
    const inflow = sum(dayEntries.filter((e) => e.amount > 0).map((e) => e.amount));
    const outflow = sum(dayEntries.filter((e) => e.amount < 0).map((e) => e.amount));
    const net = inflow + outflow;
    running += net;
    return {
      date,
      inflow,
      outflow,
      net,
      balance: running,
      entryCount: dayEntries.length,
    };
  });
}

function previousDay(date: IsoDate): IsoDate {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export interface ConsolidatedBalance {
  readonly totalCurrent: Cents;
  readonly totalProjected: Cents;
  readonly perAccount: ReadonlyArray<{
    readonly bankAccountId: string;
    readonly current: Cents;
    readonly projected: Cents;
  }>;
}

export interface AccountWithEntries extends AccountOpening {
  readonly bankAccountId: string;
  readonly entries: readonly BalanceEntry[];
}

/** Consolidated balance for the company, summing across accounts. */
export function consolidate(accounts: readonly AccountWithEntries[]): ConsolidatedBalance {
  const perAccount = accounts.map((account) => ({
    bankAccountId: account.bankAccountId,
    current: currentBalance(account, account.entries, "realizado"),
    projected: currentBalance(account, account.entries, "total"),
  }));

  return {
    totalCurrent: sum(perAccount.map((a) => a.current)),
    totalProjected: sum(perAccount.map((a) => a.projected)),
    perAccount,
  };
}

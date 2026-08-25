/**
 * Projected cash flow.
 *
 * Answers the question a spreadsheet doesn't: on what day does the cash run
 * out.
 *
 * Starts from today's balance and applies the planned transactions day by
 * day. A planned transaction that's overdue — due before today and still not
 * settled — is not dropped: it's brought forward to the first day of the
 * projection, because the bill still has to be paid. Losing it would produce
 * an optimistic projection, the worst possible defect in a tool built
 * precisely to anticipate a squeeze.
 */

import type { BalanceEntry } from "./balance";
import { addDays, BankingCalendar, compareDates, eachDay, type IsoDate } from "./dates";
import { type Cents, sum } from "./money";

export interface ProjectionEntry extends BalanceEntry {
  readonly id?: string;
  readonly description?: string;
}

export interface ProjectionInput {
  /** Starting settled balance, already consolidated. */
  readonly openingBalance: Cents;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly entries: readonly ProjectionEntry[];
  readonly calendar?: BankingCalendar;
  /** Below this the day is flagged as a warning. Absent means zero. */
  readonly minimumBalance?: Cents;
}

export interface ProjectedDay {
  readonly date: IsoDate;
  readonly isBusinessDay: boolean;
  readonly inflow: Cents;
  readonly outflow: Cents;
  readonly net: Cents;
  readonly balance: Cents;
  /** Overdue planned transactions carried forward to this day (first day only). */
  readonly overdueBroughtForward: Cents;
  readonly belowMinimum: boolean;
  readonly negative: boolean;
}

export interface ProjectionResult {
  readonly days: readonly ProjectedDay[];
  readonly finalBalance: Cents;
  readonly lowestBalance: Cents;
  readonly lowestBalanceDate: IsoDate | null;
  /** First day the balance goes negative. The alert that matters. */
  readonly firstNegativeDate: IsoDate | null;
  /** First day below the configured minimum balance. */
  readonly firstBelowMinimumDate: IsoDate | null;
  readonly totalInflow: Cents;
  readonly totalOutflow: Cents;
  readonly overdueBroughtForward: Cents;
}

export function project(input: ProjectionInput): ProjectionResult {
  const calendar = input.calendar ?? new BankingCalendar();
  const minimum = input.minimumBalance ?? 0;

  // Overdue planned transactions: due before the start of the projection and
  // still open. They enter on the first day, they don't disappear.
  const overdue = input.entries.filter(
    (entry) => entry.status === "previsto" && compareDates(entry.bookingDate, input.from) < 0,
  );
  const overdueTotal = sum(overdue.map((entry) => entry.amount));

  const byDate = new Map<IsoDate, ProjectionEntry[]>();
  for (const entry of input.entries) {
    if (compareDates(entry.bookingDate, input.from) < 0) continue;
    if (compareDates(entry.bookingDate, input.to) > 0) continue;
    const bucket = byDate.get(entry.bookingDate);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.bookingDate, [entry]);
    }
  }

  let running = input.openingBalance;
  let lowestBalance: Cents | null = null;
  let lowestBalanceDate: IsoDate | null = null;
  let firstNegativeDate: IsoDate | null = null;
  let firstBelowMinimumDate: IsoDate | null = null;
  let totalInflow = 0;
  let totalOutflow = 0;

  const days = eachDay(input.from, input.to).map((date, index): ProjectedDay => {
    // Overdue entries are treated as if they came due on the first day of the window.
    const dayEntries =
      index === 0 ? [...overdue, ...(byDate.get(date) ?? [])] : (byDate.get(date) ?? []);
    const broughtForward = index === 0 ? overdueTotal : 0;

    const inflow = sum(dayEntries.filter((e) => e.amount > 0).map((e) => e.amount));
    const outflow = sum(dayEntries.filter((e) => e.amount < 0).map((e) => e.amount));
    const net = inflow + outflow;
    running += net;
    totalInflow += inflow;
    totalOutflow += outflow;

    if (lowestBalance === null || running < lowestBalance) {
      lowestBalance = running;
      lowestBalanceDate = date;
    }
    if (running < 0 && firstNegativeDate === null) {
      firstNegativeDate = date;
    }
    if (running < minimum && firstBelowMinimumDate === null) {
      firstBelowMinimumDate = date;
    }

    return {
      date,
      isBusinessDay: calendar.isBusinessDay(date),
      inflow,
      outflow,
      net,
      balance: running,
      overdueBroughtForward: broughtForward,
      belowMinimum: running < minimum,
      negative: running < 0,
    };
  });

  return {
    days,
    finalBalance: running,
    lowestBalance: lowestBalance ?? input.openingBalance,
    lowestBalanceDate,
    firstNegativeDate,
    firstBelowMinimumDate,
    totalInflow,
    totalOutflow,
    overdueBroughtForward: overdueTotal,
  };
}

/** Shortcut for the windows the UI offers: D+30, D+60, D+90. */
export function projectHorizon(
  input: Omit<ProjectionInput, "from" | "to">,
  from: IsoDate,
  days: number,
): ProjectionResult {
  return project({ ...input, from, to: addDays(from, days) });
}

export interface RecurrenceSpec {
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate;
  /**
   * These four literals mirror the `app.recurrence_frequency` Postgres enum
   * in supabase/migrations, which this migration deliberately leaves
   * untouched.
   */
  readonly frequency: "mensal" | "semanal" | "quinzenal" | "anual";
  readonly dayOfMonth?: number;
  readonly amount: Cents;
  readonly description: string;
}

/**
 * Expands a recurrence into planned transactions within the window.
 *
 * A due date of the 31st lands on the last day of months that don't have a
 * 31st — the same way a real invoice would be issued. The business-day
 * adjustment is deliberately NOT done here: the due date is a fact of the
 * contract; if it falls on a Sunday, whoever is operating the system decides
 * whether to pay Friday or Monday, and that choice becomes its own
 * transaction.
 */
export function expandRecurrence(
  spec: RecurrenceSpec,
  from: IsoDate,
  to: IsoDate,
): ProjectionEntry[] {
  const entries: ProjectionEntry[] = [];
  const limit = spec.endDate && compareDates(spec.endDate, to) < 0 ? spec.endDate : to;

  const step = (date: IsoDate): IsoDate => {
    switch (spec.frequency) {
      case "semanal":
        return addDays(date, 7);
      case "quinzenal":
        return addDays(date, 14);
      case "mensal":
        return addMonthsKeepingDay(date, 1, spec.dayOfMonth);
      case "anual":
        return addMonthsKeepingDay(date, 12, spec.dayOfMonth);
    }
  };

  let current = spec.startDate;
  // The iteration guard protects against corrupted data; the real window is the date.
  for (let guard = 0; guard < 5000 && compareDates(current, limit) <= 0; guard++) {
    if (compareDates(current, from) >= 0) {
      entries.push({
        bookingDate: current,
        amount: spec.amount,
        status: "previsto",
        description: spec.description,
      });
    }
    current = step(current);
  }

  return entries;
}

function addMonthsKeepingDay(date: IsoDate, months: number, dayOfMonth?: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = dayOfMonth ?? Number(date.slice(8, 10));

  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));

  return target.toISOString().slice(0, 10);
}

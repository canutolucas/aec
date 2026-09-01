/**
 * Splits planned transactions (`status = 'previsto'`) into what a "to pay /
 * to receive" screen needs: overdue vs. upcoming, crossed with inflow vs.
 * outflow.
 *
 * The overdue cutoff is `bookingDate < today` — a planned entry due today
 * still counts as upcoming, not overdue. That's the same cutoff
 * `painel/page.tsx` already uses for its "N previsto(s) vencido(s)" count;
 * picking a different one here would produce two different answers to the
 * same question depending on which screen you're looking at.
 */

import { compareDates, type IsoDate } from "./dates";
import { type Cents, sum } from "./money";

export interface PlannedEntry {
  readonly id: string;
  readonly bookingDate: IsoDate;
  /** Signed — positive is inflow, negative is outflow. */
  readonly amount: Cents;
}

export interface PlannedSplit<T extends PlannedEntry> {
  readonly overdueIn: readonly T[];
  readonly overdueOut: readonly T[];
  readonly upcomingIn: readonly T[];
  readonly upcomingOut: readonly T[];
  readonly totals: {
    readonly overdueIn: Cents;
    readonly overdueOut: Cents;
    readonly upcomingIn: Cents;
    readonly upcomingOut: Cents;
  };
}

export function splitPlanned<T extends PlannedEntry>(
  entries: readonly T[],
  today: IsoDate,
): PlannedSplit<T> {
  const overdueIn: T[] = [];
  const overdueOut: T[] = [];
  const upcomingIn: T[] = [];
  const upcomingOut: T[] = [];

  for (const entry of entries) {
    const overdue = compareDates(entry.bookingDate, today) < 0;
    const inflow = entry.amount > 0;
    const bucket = overdue ? (inflow ? overdueIn : overdueOut) : inflow ? upcomingIn : upcomingOut;
    bucket.push(entry);
  }

  return {
    overdueIn,
    overdueOut,
    upcomingIn,
    upcomingOut,
    totals: {
      overdueIn: sum(overdueIn.map((e) => e.amount)),
      overdueOut: sum(overdueOut.map((e) => e.amount)),
      upcomingIn: sum(upcomingIn.map((e) => e.amount)),
      upcomingOut: sum(upcomingOut.map((e) => e.amount)),
    },
  };
}

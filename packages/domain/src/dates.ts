/**
 * Cash-flow dates.
 *
 * A transaction date is a calendar day, not an instant: "05/03/2025" is day
 * 5, no matter who opens the report or from where. That's why the type here
 * is a `YYYY-MM-DD` string and not a `Date` — `Date` carries a time and a
 * timezone, and that combination is exactly what produces the classic bug of
 * a transaction posted on the 1st showing up on the 31st of the previous
 * month.
 *
 * All arithmetic is done in UTC internally, which makes it independent of
 * the timezone of the machine running the code.
 */

/** Calendar date in ISO `YYYY-MM-DD` format. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateError extends Error {}

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

export function parseIsoDate(value: IsoDate): Date {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new DateError(`Invalid date: "${value}" (expected YYYY-MM-DD)`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const parsed = parseIsoDate(date);
  const targetDay = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  // A due date of the 31st in February lands on the last day of the month,
  // the same way a real invoice would be issued.
  const lastDay = daysInMonth(parsed.getUTCFullYear(), parsed.getUTCMonth());
  parsed.setUTCDate(Math.min(targetDay, lastDay));
  return toIsoDate(parsed);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const parsed = parseIsoDate(date);
  const last = daysInMonth(parsed.getUTCFullYear(), parsed.getUTCMonth());
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Difference in whole days. Positive when `b` is after `a`. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const millis = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(millis / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sequence of dates from `from` to `to`, inclusive on both ends. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  if (compareDates(from, to) > 0) return [];
  const dates: IsoDate[] = [];
  for (let current = from; compareDates(current, to) <= 0; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

/** Today in the Brazilian timezone — the same day `app.today()` returns in the database. */
export function todayInBrazil(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function isWeekend(date: IsoDate): boolean {
  const day = parseIsoDate(date).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * National holidays with a fixed date. The movable ones (Carnival, Good
 * Friday, Corpus Christi) are computed from Easter.
 *
 * Municipal and state holidays vary by city and aren't listed here: they
 * come in through the extra holiday list the projection accepts, configured
 * per company.
 */
const FIXED_HOLIDAYS = [
  "01-01", // New Year's Day
  "04-21", // Tiradentes Day
  "05-01", // Labour Day
  "09-07", // Independence Day
  "10-12", // Our Lady of Aparecida
  "11-02", // All Souls' Day
  "11-15", // Republic Proclamation Day
  "11-20", // Black Awareness Day
  "12-25", // Christmas
] as const;

/** Easter Sunday via the Meeus/Jones/Butcher algorithm. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

/** National banking holidays for the year, both fixed and movable. */
export function nationalHolidays(year: number): Set<IsoDate> {
  const easter = easterSunday(year);
  return new Set<IsoDate>([
    ...FIXED_HOLIDAYS.map((suffix) => `${year}-${suffix}`),
    addDays(easter, -48), // Carnival Monday
    addDays(easter, -47), // Carnival Tuesday
    addDays(easter, -2), // Good Friday
    addDays(easter, 60), // Corpus Christi
  ]);
}

/**
 * Banking calendar: knows whether money moves on a given day.
 *
 * Accepts extra holidays to cover municipal and state ones, which vary by
 * city and are therefore configured per company.
 */
export class BankingCalendar {
  private readonly cache = new Map<number, Set<IsoDate>>();
  private readonly extra: Set<IsoDate>;

  constructor(extraHolidays: readonly IsoDate[] = []) {
    this.extra = new Set(extraHolidays);
  }

  isHoliday(date: IsoDate): boolean {
    if (this.extra.has(date)) return true;
    const year = Number(date.slice(0, 4));
    let holidays = this.cache.get(year);
    if (!holidays) {
      holidays = nationalHolidays(year);
      this.cache.set(year, holidays);
    }
    return holidays.has(date);
  }

  isBusinessDay(date: IsoDate): boolean {
    return !isWeekend(date) && !this.isHoliday(date);
  }

  /** The day itself if it's a business day; otherwise the next business day. */
  nextBusinessDay(date: IsoDate): IsoDate {
    let current = date;
    // The guard only exists so this doesn't spin forever on corrupted data.
    for (let guard = 0; guard < 60; guard++) {
      if (this.isBusinessDay(current)) return current;
      current = addDays(current, 1);
    }
    throw new DateError(`No business day found starting from ${date}`);
  }

  /** The day itself if it's a business day; otherwise the previous business day. */
  previousBusinessDay(date: IsoDate): IsoDate {
    let current = date;
    for (let guard = 0; guard < 60; guard++) {
      if (this.isBusinessDay(current)) return current;
      current = addDays(current, -1);
    }
    throw new DateError(`No business day found before ${date}`);
  }
}

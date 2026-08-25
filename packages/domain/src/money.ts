/**
 * Money arithmetic.
 *
 * Money moves through this system as an integer number of cents (`Cents`),
 * never as a decimal `number`. The usual reason: 0.1 + 0.2 === 0.30000000000000004
 * in floating point, and a report that closes one cent off costs more
 * reconciliation time than the whole month of bookkeeping.
 *
 * The boundary with the database is explicit: Postgres stores `numeric(14,2)`
 * and the driver hands it back as a string (precisely to avoid floating
 * point). `fromDb` and `toDb` are the only conversion points.
 */

/** Monetary value in cents. Positive is an inflow, negative an outflow. */
export type Cents = number;

const CENTS_PER_UNIT = 100;

export class MoneyError extends Error {}

/**
 * Converts the `numeric(14,2)` value coming from the database into cents.
 *
 * Accepts both string (the format the driver returns for numeric columns)
 * and number, for values assembled by the application itself.
 */
export function fromDb(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return fromDecimal(value);
  return parseDecimalString(value);
}

/** Converts cents into the string Postgres accepts as numeric(14,2). */
export function toDb(cents: Cents): string {
  assertSafe(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / CENTS_PER_UNIT);
  const remainder = abs % CENTS_PER_UNIT;
  return `${negative ? "-" : ""}${units}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Converts a decimal number into cents, rounding to the nearest cent. Uses
 * `Math.round` on the already-scaled value, with an epsilon correction:
 * 1.005 * 100 yields 100.49999999999999 in floating point, which would round
 * down.
 */
export function fromDecimal(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Invalid monetary value: ${value}`);
  }
  const scaled = value * CENTS_PER_UNIT;
  const rounded = Math.round(
    scaled + (scaled >= 0 ? Number.EPSILON : -Number.EPSILON) * Math.abs(scaled),
  );
  assertSafe(rounded);
  return rounded;
}

/** Converts cents back to decimal. Use only for display or export. */
export function toDecimal(cents: Cents): number {
  assertSafe(cents);
  return cents / CENTS_PER_UNIT;
}

/**
 * Parses what the user typed.
 *
 * Accepts the formats that show up for real when someone is coming from
 * Excel: "1.234,56", "1234,56", "1234.56", "R$ 1.234,56", "-50", "(50)" for
 * negative.
 *
 * The separator rule: when there's a comma, it's the decimal mark and the dot
 * is the thousands separator — the Brazilian convention. Without a comma, a
 * dot is only a decimal mark if it separates at most two digits ("12.50");
 * "1.234" is one thousand, two hundred and thirty-four.
 */
export function parseUserInput(input: string): Cents {
  const raw = input.trim();
  if (raw === "") {
    throw new MoneyError("Empty value");
  }

  // Parentheses signal negative in accounting notation: (1.234,56)
  const parenthesized = /^\((.*)\)$/.exec(raw);
  const body = parenthesized ? parenthesized[1]! : raw;

  let cleaned = body.replace(/R\$/gi, "").replace(/\s/g, "");
  let negative = parenthesized !== null;

  if (cleaned.startsWith("-")) {
    negative = !negative;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  if (!/^[\d.,]+$/.test(cleaned)) {
    throw new MoneyError(`Invalid monetary value: "${input}"`);
  }

  let normalized: string;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1]!;
    // "12.50" -> decimal.  "1.234" or "1.234.567" -> thousands separator.
    normalized =
      parts.length > 1 && last.length <= 2 && parts.length === 2 ? cleaned : parts.join("");
  }

  if (normalized === "" || normalized === ".") {
    throw new MoneyError(`Invalid monetary value: "${input}"`);
  }

  const cents = parseDecimalString(normalized);
  return negative ? -cents : cents;
}

/**
 * Parses a decimal string without going through floating point: splits the
 * integer part from the fractional part and builds the cents with integer
 * arithmetic.
 */
function parseDecimalString(value: string): Cents {
  const trimmed = value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new MoneyError(`Invalid monetary value: "${value}"`);
  }

  const [, sign, integerPart, fractionPart = ""] = match;
  const units = integerPart === "" ? 0 : Number(integerPart);

  // Rounds from the third decimal place onward, instead of truncating.
  const twoDigits = fractionPart.slice(0, 2).padEnd(2, "0");
  const thirdDigit = fractionPart.charCodeAt(2) - 48;
  let cents = units * CENTS_PER_UNIT + Number(twoDigits);
  if (thirdDigit >= 5 && thirdDigit <= 9) {
    cents += 1;
  }

  assertSafe(cents);
  return sign === "-" ? -cents : cents;
}

/** Safe sum: raises on overflow instead of silently returning a wrong number. */
export function sum(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  assertSafe(total);
  return total;
}

/**
 * Splits a total into N equal parts without losing or inventing a cent.
 *
 * The cents left over from the division go to the first installments, which
 * is how a real installment plan is charged in practice. The sum of the
 * parts always equals the total — the property that matters once this turns
 * into a transaction.
 */
export function allocate(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Invalid number of installments: ${parts}`);
  }

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;

  return Array.from(
    { length: parts },
    (_unused, index) => sign * (base + (index < remainder ? 1 : 0)),
  );
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats as currency: R$ 1.234,56 */
export function formatBRL(cents: Cents): string {
  return currencyFormatter.format(toDecimal(cents));
}

/** Formats without the symbol, for dense grids: 1.234,56 */
export function formatAmount(cents: Cents): string {
  return decimalFormatter.format(toDecimal(cents));
}

export function isInflow(cents: Cents): boolean {
  return cents > 0;
}

export function isOutflow(cents: Cents): boolean {
  return cents < 0;
}

/**
 * The largest value that fits in numeric(14,2) and is still an exact
 * integer in JavaScript. Going past this means something summed what it
 * shouldn't have.
 */
const MAX_CENTS = 999_999_999_999.99 * CENTS_PER_UNIT;

function assertSafe(cents: number): void {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new MoneyError(`Cents value must be a finite integer, got ${cents}`);
  }
  if (Math.abs(cents) > MAX_CENTS) {
    throw new MoneyError(`Monetary value out of supported range: ${cents}`);
  }
}

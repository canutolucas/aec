import { describe, expect, it } from "vitest";

import {
  allocate,
  formatAmount,
  formatBRL,
  fromDb,
  fromDecimal,
  MoneyError,
  parseUserInput,
  sum,
  toDb,
  toDecimal,
} from "../src/money";

describe("boundary with the database", () => {
  it("reads the numeric(14,2) the driver hands back as a string", () => {
    expect(fromDb("1234.56")).toBe(123456);
    expect(fromDb("-1800.00")).toBe(-180000);
    expect(fromDb("0.01")).toBe(1);
    expect(fromDb("10000")).toBe(1000000);
  });

  it("treats null as zero", () => {
    expect(fromDb(null)).toBe(0);
    expect(fromDb(undefined)).toBe(0);
  });

  it("returns the string Postgres accepts as numeric", () => {
    expect(toDb(123456)).toBe("1234.56");
    expect(toDb(-180000)).toBe("-1800.00");
    expect(toDb(1)).toBe("0.01");
    expect(toDb(-1)).toBe("-0.01");
    expect(toDb(0)).toBe("0.00");
    expect(toDb(100)).toBe("1.00");
  });

  it("round-trips database -> cents -> database without losing anything", () => {
    for (const value of ["0.00", "0.01", "-0.01", "9999.99", "-1234.05", "1000000.00"]) {
      expect(toDb(fromDb(value))).toBe(value);
    }
  });
});

describe("the reason cents exist", () => {
  it("sums 0.10 + 0.20 to exactly 0.30", () => {
    // In floating point this would give 0.30000000000000004 and the month would
    // close one cent off. This is the bug this whole module exists to prevent.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sum([fromDb("0.10"), fromDb("0.20")])).toBe(fromDb("0.30"));
    expect(toDb(sum([fromDb("0.10"), fromDb("0.20")]))).toBe("0.30");
  });

  it("sums a thousand cents without accumulating error", () => {
    const values = Array.from({ length: 1000 }, () => fromDb("0.01"));
    expect(toDb(sum(values))).toBe("10.00");
  });

  it("keeps exactness across a long statement of odd values", () => {
    const statement = ["1234.56", "-987.65", "0.03", "-0.01", "45678.90", "-45678.90"];
    const total = sum(statement.map(fromDb));
    expect(toDb(total)).toBe("246.93");
  });
});

describe("rounding", () => {
  it("rounds half a cent up instead of truncating", () => {
    expect(fromDb("1.005")).toBe(101);
    expect(fromDb("2.345")).toBe(235);
  });

  it("rounds down below half a cent", () => {
    expect(fromDb("1.004")).toBe(100);
    expect(fromDb("2.344")).toBe(234);
  });

  it("converts a floating point decimal without falling into the float bug", () => {
    expect(fromDecimal(1.005)).toBe(101);
    expect(fromDecimal(0.07)).toBe(7);
    expect(fromDecimal(1234.56)).toBe(123456);
    expect(fromDecimal(-0.29)).toBe(-29);
  });

  it("converts back to decimal when it needs to be displayed", () => {
    expect(toDecimal(123456)).toBe(1234.56);
    expect(toDecimal(-1)).toBe(-0.01);
  });
});

describe("what the user types coming from Excel", () => {
  it("accepts the Brazilian format with thousands dot and comma", () => {
    expect(parseUserInput("1.234,56")).toBe(123456);
    expect(parseUserInput("1.234.567,89")).toBe(123456789);
    expect(parseUserInput("1234,56")).toBe(123456);
  });

  it("accepts a dot as decimal when there's no comma", () => {
    expect(parseUserInput("1234.56")).toBe(123456);
    expect(parseUserInput("12.50")).toBe(1250);
  });

  it("reads a dot as thousands separator when it separates three digits", () => {
    // "1.234" is one thousand, two hundred and thirty-four, not one real
    // and twenty-three cents.
    expect(parseUserInput("1.234")).toBe(123400);
    expect(parseUserInput("1.234.567")).toBe(123456700);
  });

  it("accepts the currency symbol and spaces", () => {
    expect(parseUserInput("R$ 1.234,56")).toBe(123456);
    expect(parseUserInput("  R$1234,56  ")).toBe(123456);
  });

  it("understands negative with a sign and with accounting-notation parentheses", () => {
    expect(parseUserInput("-1.234,56")).toBe(-123456);
    expect(parseUserInput("(1.234,56)")).toBe(-123456);
    expect(parseUserInput("(R$ 50,00)")).toBe(-5000);
  });

  it("accepts a plain integer", () => {
    expect(parseUserInput("50")).toBe(5000);
    expect(parseUserInput("0")).toBe(0);
  });

  it("rejects what isn't a value, instead of silently returning NaN", () => {
    for (const input of ["", "   ", "abc", "12,34,56", "R$", "1e5", "--5"]) {
      expect(() => parseUserInput(input), `should reject "${input}"`).toThrow(MoneyError);
    }
  });
});

describe("installments", () => {
  it("splits without losing or inventing a cent", () => {
    const installments = allocate(10000, 3);
    expect(installments).toEqual([3334, 3333, 3333]);
    expect(sum(installments)).toBe(10000);
  });

  it("keeps the sum exact for any number of installments", () => {
    for (let parts = 1; parts <= 24; parts++) {
      for (const total of [10000, 99999, 1, 7, 123456789]) {
        expect(sum(allocate(total, parts)), `${total} in ${parts}x`).toBe(total);
      }
    }
  });

  it("preserves the sign when splitting an outflow", () => {
    const installments = allocate(-10000, 3);
    expect(installments).toEqual([-3334, -3333, -3333]);
    expect(sum(installments)).toBe(-10000);
  });

  it("rejects an invalid number of installments", () => {
    expect(() => allocate(100, 0)).toThrow(MoneyError);
    expect(() => allocate(100, -1)).toThrow(MoneyError);
    expect(() => allocate(100, 1.5)).toThrow(MoneyError);
  });
});

describe("formatting", () => {
  it("formats as Brazilian currency", () => {
    // Intl's separator here is a non-breaking space (U+00A0), not a regular
    // space. Matched via a unicode escape, since a literal one is too easy to
    // silently flatten to a plain space when a file is copied or retyped.
    expect(formatBRL(123456).replace(/\u00A0/g, " ")).toBe("R$ 1.234,56");
    expect(formatBRL(-180000).replace(/\u00A0/g, " ")).toBe("-R$ 1.800,00");
    expect(formatBRL(0).replace(/\u00A0/g, " ")).toBe("R$ 0,00");
  });

  it("formats without the symbol for dense grids", () => {
    expect(formatAmount(123456)).toBe("1.234,56");
    expect(formatAmount(-1)).toBe("-0,01");
  });
});

describe("limits", () => {
  it("rejects a non-finite value", () => {
    expect(() => fromDecimal(Number.NaN)).toThrow(MoneyError);
    expect(() => fromDecimal(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it("flags overflow instead of returning an imprecise number", () => {
    expect(() => toDb(Number.MAX_SAFE_INTEGER)).toThrow(MoneyError);
  });
});

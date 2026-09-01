import { describe, expect, it } from "vitest";

import { canCloseMonth, statementCoverage, workingMonth } from "../src/monthly-cycle";

describe("workingMonth", () => {
  it("on the 1st of a new month, works on the previous month if it isn't closed", () => {
    expect(workingMonth({ today: "2025-09-01", closedPeriods: [] })).toBe("2025-08-01");
  });

  it("mid-month, still works on the previous month if it isn't closed", () => {
    expect(workingMonth({ today: "2025-09-15", closedPeriods: [] })).toBe("2025-08-01");
  });

  it("moves to the current month once the previous one is closed", () => {
    expect(workingMonth({ today: "2025-09-15", closedPeriods: ["2025-08-05"] })).toBe("2025-09-01");
  });

  it("accepts a closed period from any day within the month", () => {
    expect(workingMonth({ today: "2025-09-01", closedPeriods: ["2025-08-31"] })).toBe("2025-09-01");
  });

  it("does not go back before the earliest activity", () => {
    expect(
      workingMonth({ today: "2025-09-05", closedPeriods: [], earliestActivity: "2025-09-02" }),
    ).toBe("2025-09-01");
  });

  it("with activity inside the previous month, still returns the previous month", () => {
    expect(
      workingMonth({ today: "2025-09-05", closedPeriods: [], earliestActivity: "2025-08-20" }),
    ).toBe("2025-08-01");
  });
});

describe("canCloseMonth", () => {
  it("refuses a month still in progress", () => {
    expect(canCloseMonth("2025-09-01", "2025-09-15")).toBe(false);
    expect(canCloseMonth("2025-09-01", "2025-09-30")).toBe(false);
  });

  it("allows a month once it has ended", () => {
    expect(canCloseMonth("2025-09-01", "2025-10-01")).toBe(true);
  });

  it("works from any day within the period, not just the 1st", () => {
    expect(canCloseMonth("2025-09-20", "2025-10-01")).toBe(true);
  });
});

describe("statementCoverage", () => {
  const accounts = [
    { id: "a1", openingBalanceDate: "2025-01-01" },
    { id: "a2", openingBalanceDate: "2025-01-01" },
  ];

  it("covers an account whose import reaches the end of the period", () => {
    const result = statementCoverage({
      period: "2025-09-15",
      accounts,
      imports: [
        { bankAccountId: "a1", periodEnd: "2025-09-30" },
        { bankAccountId: "a2", periodEnd: "2025-09-10" },
      ],
    });
    expect(result.covered).toEqual(["a1"]);
    expect(result.missing).toEqual(["a2"]);
  });

  it("an import reaching past the period end still counts", () => {
    const result = statementCoverage({
      period: "2025-09-01",
      accounts,
      imports: [{ bankAccountId: "a1", periodEnd: "2025-10-05" }],
    });
    expect(result.covered).toEqual(["a1"]);
  });

  it("ignores imports without a declared period end", () => {
    const result = statementCoverage({
      period: "2025-09-01",
      accounts,
      imports: [{ bankAccountId: "a1", periodEnd: null }],
    });
    expect(result.covered).toEqual([]);
    expect(result.missing).toEqual(["a1", "a2"]);
  });

  it("does not flag an account opened after the period ended", () => {
    const result = statementCoverage({
      period: "2025-01-01",
      accounts: [{ id: "a3", openingBalanceDate: "2025-06-01" }],
      imports: [],
    });
    expect(result.missing).toEqual([]);
    expect(result.covered).toEqual([]);
  });

  it("handles no accounts and no imports", () => {
    const result = statementCoverage({ period: "2025-09-01", accounts: [], imports: [] });
    expect(result.covered).toEqual([]);
    expect(result.missing).toEqual([]);
  });
});

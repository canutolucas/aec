import { describe, expect, it } from "vitest";

import { BankingCalendar } from "../src/dates";
import { fromDb, toDb } from "../src/money";
import { expandRecurrence, project, projectHorizon, type ProjectionEntry } from "../src/projection";

function planned(bookingDate: string, amount: string, description = "planned"): ProjectionEntry {
  return { bookingDate, amount: fromDb(amount), status: "previsto", description };
}

describe("cash-flow projection", () => {
  it("applies the planned entries day by day from today's balance", () => {
    const result = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-06",
      entries: [planned("2025-03-04", "-3000.00"), planned("2025-03-05", "1500.00")],
    });

    expect(result.days.map((d) => toDb(d.balance))).toEqual([
      "10000.00", // 03
      "7000.00", // 04
      "8500.00", // 05
      "8500.00", // 06
    ]);
    expect(toDb(result.finalBalance)).toBe("8500.00");
  });

  it("points to the exact date the cash runs out", () => {
    // The answer this tool exists to give.
    const result = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [
        planned("2025-03-05", "-2000.00", "Payroll"),
        planned("2025-03-07", "-4000.00", "Supplier"),
        planned("2025-03-09", "3000.00", "Receipt"),
      ],
    });

    expect(result.firstNegativeDate).toBe("2025-03-07");
    expect(toDb(result.lowestBalance)).toBe("-1000.00");
    expect(result.lowestBalanceDate).toBe("2025-03-07");
    expect(toDb(result.finalBalance)).toBe("2000.00");
  });

  it("doesn't flag a shortfall when the cash stays positive", () => {
    const result = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [planned("2025-03-05", "-2000.00")],
    });

    expect(result.firstNegativeDate).toBeNull();
    expect(toDb(result.lowestBalance)).toBe("8000.00");
  });

  it("warns below the minimum balance before hitting zero", () => {
    // Many companies need to keep a cushion. The useful alert fires before
    // the balance goes negative, not after.
    const result = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [planned("2025-03-05", "-7000.00")],
      minimumBalance: fromDb("5000.00"),
    });

    expect(result.firstBelowMinimumDate).toBe("2025-03-05");
    expect(result.firstNegativeDate).toBeNull();
    expect(result.days.find((d) => d.date === "2025-03-05")?.belowMinimum).toBe(true);
    expect(result.days.find((d) => d.date === "2025-03-04")?.belowMinimum).toBe(false);
  });
});

describe("an overdue, unpaid planned transaction", () => {
  it("is brought forward to the first day, not dropped from the projection", () => {
    // If the overdue amount disappeared, the projection would be optimistic —
    // the worst possible defect in a tool built to anticipate a squeeze.
    const result = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-10",
      to: "2025-03-12",
      entries: [
        planned("2025-03-01", "-2000.00", "Overdue supplier"),
        planned("2025-02-20", "-1000.00", "Overdue tax"),
        planned("2025-03-11", "-500.00", "Not yet due"),
      ],
    });

    expect(toDb(result.overdueBroughtForward)).toBe("-3000.00");
    expect(toDb(result.days[0]!.balance)).toBe("2000.00");
    expect(toDb(result.days[0]!.overdueBroughtForward)).toBe("-3000.00");
    expect(toDb(result.finalBalance)).toBe("1500.00");
  });

  it("doesn't repeat the overdue amount on the following days", () => {
    const result = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-10",
      to: "2025-03-12",
      entries: [planned("2025-03-01", "-2000.00")],
    });

    expect(result.days.map((d) => toDb(d.overdueBroughtForward))).toEqual([
      "-2000.00",
      "0.00",
      "0.00",
    ]);
    expect(toDb(result.finalBalance)).toBe("3000.00");
  });

  it("counts an overdue receipt too, not just an overdue expense", () => {
    const result = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-10",
      to: "2025-03-10",
      entries: [planned("2025-03-01", "2500.00", "Late-paying client")],
    });

    expect(toDb(result.days[0]!.balance)).toBe("3500.00");
  });
});

describe("business days in the projection", () => {
  it("flags weekend and holiday", () => {
    const result = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-07", // Friday
      to: "2025-03-10", // Monday
      entries: [],
      calendar: new BankingCalendar(),
    });

    expect(result.days.map((d) => d.isBusinessDay)).toEqual([true, false, false, true]);
  });

  it("flags Carnival as a non-business day", () => {
    const result = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-03", // Carnival Monday
      to: "2025-03-05", // Ash Wednesday
      entries: [],
    });

    expect(result.days.map((d) => d.isBusinessDay)).toEqual([false, false, true]);
  });
});

describe("D+30, D+60 and D+90 windows", () => {
  it("projects the requested horizon", () => {
    const base = { openingBalance: fromDb("10000.00"), entries: [] as ProjectionEntry[] };

    expect(projectHorizon(base, "2025-03-01", 30).days).toHaveLength(31);
    expect(projectHorizon(base, "2025-03-01", 60).days).toHaveLength(61);
    expect(projectHorizon(base, "2025-03-01", 90).days.at(-1)?.date).toBe("2025-05-30");
  });
});

describe("recurrence expansion", () => {
  it("generates one planned transaction per month", () => {
    const planned = expandRecurrence(
      {
        startDate: "2025-01-10",
        frequency: "mensal",
        amount: fromDb("-3500.00"),
        description: "Rent",
      },
      "2025-01-01",
      "2025-04-30",
    );

    expect(planned.map((p) => p.bookingDate)).toEqual([
      "2025-01-10",
      "2025-02-10",
      "2025-03-10",
      "2025-04-10",
    ]);
    expect(planned.every((p) => p.status === "previsto")).toBe(true);
  });

  it("carries a due date of the 31st to the last day of shorter months", () => {
    const planned = expandRecurrence(
      {
        startDate: "2025-01-31",
        frequency: "mensal",
        dayOfMonth: 31,
        amount: fromDb("-1000.00"),
        description: "Tax",
      },
      "2025-01-01",
      "2025-05-31",
    );

    expect(planned.map((p) => p.bookingDate)).toEqual([
      "2025-01-31",
      "2025-02-28", // February has no 31st
      "2025-03-31",
      "2025-04-30", // April has no 31st
      "2025-05-31",
    ]);
  });

  it("respects the recurrence's end date", () => {
    const planned = expandRecurrence(
      {
        startDate: "2025-01-10",
        endDate: "2025-03-01",
        frequency: "mensal",
        amount: fromDb("-500.00"),
        description: "Ended contract",
      },
      "2025-01-01",
      "2025-06-30",
    );

    expect(planned.map((p) => p.bookingDate)).toEqual(["2025-01-10", "2025-02-10"]);
  });

  it("generates weekly and biweekly", () => {
    const weekly = expandRecurrence(
      {
        startDate: "2025-03-03",
        frequency: "semanal",
        amount: fromDb("-100.00"),
        description: "x",
      },
      "2025-03-01",
      "2025-03-24",
    );
    expect(weekly.map((p) => p.bookingDate)).toEqual([
      "2025-03-03",
      "2025-03-10",
      "2025-03-17",
      "2025-03-24",
    ]);

    const biweekly = expandRecurrence(
      {
        startDate: "2025-03-03",
        frequency: "quinzenal",
        amount: fromDb("-100.00"),
        description: "x",
      },
      "2025-03-01",
      "2025-03-31",
    );
    expect(biweekly.map((p) => p.bookingDate)).toEqual(["2025-03-03", "2025-03-17", "2025-03-31"]);
  });

  it("ignores occurrences before the requested window", () => {
    const planned = expandRecurrence(
      { startDate: "2024-01-10", frequency: "mensal", amount: fromDb("-100.00"), description: "x" },
      "2025-02-01",
      "2025-03-31",
    );
    expect(planned.map((p) => p.bookingDate)).toEqual(["2025-02-10", "2025-03-10"]);
  });
});

describe("projection fed by a recurrence", () => {
  it("combines recurrence and one-off planned entries in the same flow", () => {
    const rent = expandRecurrence(
      {
        startDate: "2025-03-05",
        frequency: "mensal",
        amount: fromDb("-3000.00"),
        description: "Rent",
      },
      "2025-03-01",
      "2025-04-30",
    );

    const result = project({
      openingBalance: fromDb("4000.00"),
      from: "2025-03-01",
      to: "2025-04-30",
      entries: [...rent, planned("2025-03-20", "2000.00", "Receipt")],
    });

    // 4,000 - 3,000 = 1,000 on 03/05; +2,000 = 3,000 on 03/20; -3,000 = 0 on 04/05.
    expect(toDb(result.finalBalance)).toBe("0.00");
    expect(result.firstNegativeDate).toBeNull();
    expect(toDb(result.days.find((d) => d.date === "2025-03-05")!.balance)).toBe("1000.00");
  });
});

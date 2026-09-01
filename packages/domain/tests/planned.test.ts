import { describe, expect, it } from "vitest";

import { fromDb } from "../src/money";
import { type PlannedEntry, splitPlanned } from "../src/planned";

function entry(id: string, bookingDate: string, amount: string): PlannedEntry {
  return { id, bookingDate, amount: fromDb(amount) };
}

const TODAY = "2025-03-15";

describe("splitPlanned", () => {
  it("splits by overdue/upcoming and inflow/outflow", () => {
    const result = splitPlanned(
      [
        entry("a", "2025-03-10", "1000.00"), // overdue in
        entry("b", "2025-03-10", "-500.00"), // overdue out
        entry("c", "2025-03-20", "2000.00"), // upcoming in
        entry("d", "2025-03-20", "-800.00"), // upcoming out
      ],
      TODAY,
    );

    expect(result.overdueIn.map((e) => e.id)).toEqual(["a"]);
    expect(result.overdueOut.map((e) => e.id)).toEqual(["b"]);
    expect(result.upcomingIn.map((e) => e.id)).toEqual(["c"]);
    expect(result.upcomingOut.map((e) => e.id)).toEqual(["d"]);
  });

  it("a planned entry due today is upcoming, not overdue", () => {
    const result = splitPlanned([entry("a", TODAY, "1000.00")], TODAY);
    expect(result.overdueIn).toEqual([]);
    expect(result.upcomingIn.map((e) => e.id)).toEqual(["a"]);
  });

  it("sums totals per bucket", () => {
    const result = splitPlanned(
      [
        entry("a", "2025-03-01", "1000.00"),
        entry("b", "2025-03-02", "500.00"),
        entry("c", "2025-03-01", "-300.00"),
        entry("d", "2025-04-01", "700.00"),
        entry("e", "2025-04-01", "-200.00"),
      ],
      TODAY,
    );

    expect(result.totals.overdueIn).toBe(fromDb("1500.00"));
    expect(result.totals.overdueOut).toBe(fromDb("-300.00"));
    expect(result.totals.upcomingIn).toBe(fromDb("700.00"));
    expect(result.totals.upcomingOut).toBe(fromDb("-200.00"));
  });

  it("handles an empty list", () => {
    const result = splitPlanned([], TODAY);
    expect(result.overdueIn).toEqual([]);
    expect(result.overdueOut).toEqual([]);
    expect(result.upcomingIn).toEqual([]);
    expect(result.upcomingOut).toEqual([]);
    expect(result.totals).toEqual({
      overdueIn: 0,
      overdueOut: 0,
      upcomingIn: 0,
      upcomingOut: 0,
    });
  });
});

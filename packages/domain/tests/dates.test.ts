import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  BankingCalendar,
  DateError,
  daysBetween,
  eachDay,
  easterSunday,
  endOfMonth,
  isIsoDate,
  nationalHolidays,
  startOfMonth,
  todayInBrazil,
} from "../src/dates";

describe("a cash-flow date is a calendar day, not an instant", () => {
  it("doesn't shift the date because of the machine's timezone", () => {
    // The classic bug: `new Date("2025-03-01")` in a negative timezone becomes
    // 02/28 when formatted locally. Here the date is a string and the
    // arithmetic is in UTC, so the month rollover never slips.
    expect(addDays("2025-03-01", 0)).toBe("2025-03-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("crosses the year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap year", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("validates the format and rejects a date that doesn't exist", () => {
    expect(isIsoDate("2025-03-05")).toBe(true);
    expect(isIsoDate("2025-02-30")).toBe(false);
    expect(isIsoDate("05/03/2025")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
    expect(() => addDays("05/03/2025", 1)).toThrow(DateError);
  });
});

describe("monthly due date", () => {
  it("carries the 31st to the last day of shorter months", () => {
    // A due date of the 31st in February is charged on the 28th, the same way
    // a real invoice would be.
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-01-31", 3)).toBe("2025-04-30");
  });

  it("preserves the day when it exists in the target month", () => {
    expect(addMonths("2025-01-15", 1)).toBe("2025-02-15");
    expect(addMonths("2025-03-31", 2)).toBe("2025-05-31");
  });
});

describe("month boundaries", () => {
  it("computes the first and last day", () => {
    expect(startOfMonth("2025-03-17")).toBe("2025-03-01");
    expect(endOfMonth("2025-03-17")).toBe("2025-03-31");
    expect(endOfMonth("2025-02-10")).toBe("2025-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });
});

describe("ranges", () => {
  it("counts days between two dates", () => {
    expect(daysBetween("2025-03-01", "2025-03-31")).toBe(30);
    expect(daysBetween("2025-03-31", "2025-03-01")).toBe(-30);
    expect(daysBetween("2025-03-01", "2025-03-01")).toBe(0);
  });

  it("doesn't drift because of daylight saving time", () => {
    // In timezones with daylight saving, a day has 23 or 25 hours and the
    // division by 86,400,000 slips. Rounding covers that.
    expect(daysBetween("2025-10-01", "2025-11-01")).toBe(31);
    expect(daysBetween("2025-02-01", "2025-03-01")).toBe(28);
  });

  it("generates the sequence inclusive on both ends", () => {
    expect(eachDay("2025-03-01", "2025-03-04")).toEqual([
      "2025-03-01",
      "2025-03-02",
      "2025-03-03",
      "2025-03-04",
    ]);
    expect(eachDay("2025-03-01", "2025-03-01")).toEqual(["2025-03-01"]);
    expect(eachDay("2025-03-05", "2025-03-01")).toEqual([]);
  });
});

describe("banking holidays", () => {
  it("computes Easter", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });

  it("includes the movable holidays derived from Easter", () => {
    const holidays = nationalHolidays(2025);
    expect(holidays.has("2025-03-03")).toBe(true); // Carnival Monday
    expect(holidays.has("2025-03-04")).toBe(true); // Carnival Tuesday
    expect(holidays.has("2025-04-18")).toBe(true); // Good Friday
    expect(holidays.has("2025-06-19")).toBe(true); // Corpus Christi
  });

  it("includes the fixed holidays", () => {
    const holidays = nationalHolidays(2025);
    expect(holidays.has("2025-01-01")).toBe(true);
    expect(holidays.has("2025-09-07")).toBe(true);
    expect(holidays.has("2025-12-25")).toBe(true);
  });
});

describe("banking calendar", () => {
  const calendar = new BankingCalendar();

  it("knows when money doesn't move", () => {
    expect(calendar.isBusinessDay("2025-03-05")).toBe(true); // regular Wednesday
    expect(calendar.isBusinessDay("2025-03-08")).toBe(false); // Saturday
    expect(calendar.isBusinessDay("2025-03-09")).toBe(false); // Sunday
    expect(calendar.isBusinessDay("2025-12-25")).toBe(false); // Christmas
    expect(calendar.isBusinessDay("2025-03-04")).toBe(false); // Carnival
  });

  it("advances to the next business day", () => {
    expect(calendar.nextBusinessDay("2025-03-08")).toBe("2025-03-10"); // Saturday -> Monday
    expect(calendar.nextBusinessDay("2025-03-05")).toBe("2025-03-05"); // already a business day
    // Christmas 2025 is a Thursday; the 26th is a business Friday.
    expect(calendar.nextBusinessDay("2025-12-25")).toBe("2025-12-26");
  });

  it("steps back to the previous business day", () => {
    expect(calendar.previousBusinessDay("2025-03-09")).toBe("2025-03-07"); // Sunday -> Friday
    expect(calendar.previousBusinessDay("2025-03-05")).toBe("2025-03-05");
  });

  it("crosses a long run of holiday and weekend", () => {
    // 2025: Carnival on Monday 03/03 and Tuesday 03/04. Coming from Saturday
    // 03/01, the next business day is Ash Wednesday, 03/05.
    expect(calendar.nextBusinessDay("2025-03-01")).toBe("2025-03-05");
  });

  it("accepts a municipal holiday configured per company", () => {
    // São Paulo's city anniversary, 01/25/2024, a Thursday. Not a national
    // holiday — it's only a non-business day for whoever is in that city.
    const saoPauloCalendar = new BankingCalendar(["2024-01-25"]);

    expect(calendar.isBusinessDay("2024-01-25")).toBe(true);
    expect(saoPauloCalendar.isBusinessDay("2024-01-25")).toBe(false);
    expect(saoPauloCalendar.isHoliday("2024-01-25")).toBe(true);
    expect(saoPauloCalendar.nextBusinessDay("2024-01-25")).toBe("2024-01-26");
  });
});

describe("today in the Brazilian timezone", () => {
  it("uses São Paulo's date, not the UTC server's", () => {
    // January 1st at 02:00 UTC is still December 31st in Brazil (UTC-3).
    const rollover = new Date("2026-01-01T02:00:00Z");
    expect(todayInBrazil(rollover)).toBe("2025-12-31");
  });

  it("returns a valid ISO date", () => {
    expect(isIsoDate(todayInBrazil())).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  type AccountOpening,
  type BalanceEntry,
  balanceOn,
  checkBalance,
  consolidate,
  currentBalance,
  dailyBalances,
} from "../src/balance";
import { fromDb, toDb } from "../src/money";

const account: AccountOpening = {
  openingBalance: fromDb("10000.00"),
  openingBalanceDate: "2025-01-01",
};

function entry(
  bookingDate: string,
  amount: string,
  status: "realizado" | "previsto" = "realizado",
): BalanceEntry {
  return { bookingDate, amount: fromDb(amount), status };
}

describe("balance on a date", () => {
  const movement = [
    entry("2025-03-05", "2500.00"),
    entry("2025-03-10", "-1800.00"),
    entry("2025-04-02", "-700.00"),
  ];

  it("starts from the opening balance and sums the movement up to the date", () => {
    expect(toDb(balanceOn(account, movement, "2025-03-04"))).toBe("10000.00");
    expect(toDb(balanceOn(account, movement, "2025-03-05"))).toBe("12500.00");
    expect(toDb(balanceOn(account, movement, "2025-03-31"))).toBe("10700.00");
    expect(toDb(balanceOn(account, movement, "2025-04-30"))).toBe("10000.00");
  });

  it("includes the query date itself", () => {
    expect(toDb(balanceOn(account, movement, "2025-03-10"))).toBe("10700.00");
  });

  it("returns zero before the opening balance date", () => {
    expect(balanceOn(account, movement, "2024-12-31")).toBe(0);
  });
});

describe("checking a declared balance against the system's own ledger", () => {
  const movement = [entry("2025-03-05", "2500.00"), entry("2025-03-10", "-1800.00")];

  it("reports zero diff when the bank's number and the system's agree", () => {
    const result = checkBalance(account, movement, {
      bankAccountId: "acc-1",
      balance: fromDb("10700.00"),
      date: "2025-03-31",
    });
    expect(result.diff).toBe(0);
    expect(result.computedBalance).toBe(fromDb("10700.00"));
    expect(result.declaredBalance).toBe(fromDb("10700.00"));
    expect(result.declaredDate).toBe("2025-03-31");
    expect(result.bankAccountId).toBe("acc-1");
  });

  it("diff is computed minus declared, so a positive diff means the system sees more money than the bank does", () => {
    // The system's ledger is missing the -1800 outflow — it thinks the
    // balance is 1800 higher than the bank's own number.
    const result = checkBalance(account, [movement[0]!], {
      bankAccountId: "acc-1",
      balance: fromDb("10700.00"),
      date: "2025-03-31",
    });
    expect(toDb(result.diff)).toBe("1800.00");
  });

  it("a missing inflow makes the system's balance look lower than the bank's", () => {
    const result = checkBalance(account, [movement[1]!], {
      bankAccountId: "acc-1",
      balance: fromDb("10700.00"),
      date: "2025-03-31",
    });
    expect(toDb(result.diff)).toBe("-2500.00");
  });

  it("checks as of the declared date, ignoring movement that comes after it", () => {
    const withLaterMovement = [...movement, entry("2025-04-02", "-700.00")];
    const result = checkBalance(account, withLaterMovement, {
      bankAccountId: "acc-1",
      balance: fromDb("10700.00"),
      date: "2025-03-31",
    });
    expect(result.diff).toBe(0);
  });
});

describe("the order of transactions doesn't affect the balance", () => {
  it("reaches the same balance with the movement shuffled", () => {
    // Matters when the statement arrives out of order, or when someone
    // retroactively books something they forgot.
    const inOrder = [
      entry("2025-03-01", "100.00"),
      entry("2025-03-02", "-50.00"),
      entry("2025-03-03", "25.00"),
    ];
    const shuffled = [inOrder[2]!, inOrder[0]!, inOrder[1]!];

    expect(currentBalance(account, shuffled)).toBe(currentBalance(account, inOrder));
    expect(toDb(currentBalance(account, shuffled))).toBe("10075.00");
  });
});

describe("a transaction before the opening balance", () => {
  it("is ignored, because the opening balance already includes it", () => {
    // Summing it again would count the same money twice. The database
    // rejects such transactions on write; the calculation also has to be
    // right against imported historical data.
    const withEarlier = [entry("2024-12-15", "5000.00"), entry("2025-03-05", "2500.00")];
    expect(toDb(currentBalance(account, withEarlier))).toBe("12500.00");
  });
});

describe("planned vs. settled", () => {
  const movement = [entry("2025-03-05", "2500.00"), entry("2025-03-20", "-1000.00", "previsto")];

  it("the settled balance ignores what's planned", () => {
    expect(toDb(currentBalance(account, movement, "realizado"))).toBe("12500.00");
  });

  it("the total balance includes what's planned", () => {
    expect(toDb(currentBalance(account, movement, "total"))).toBe("11500.00");
  });
});

describe("day-by-day ledger", () => {
  const movement = [
    entry("2025-03-05", "2500.00"),
    entry("2025-03-05", "300.00"),
    entry("2025-03-07", "-1800.00"),
  ];

  it("returns every day in the range, even the ones with no movement", () => {
    const days = dailyBalances(account, movement, "2025-03-04", "2025-03-08");
    expect(days.map((d) => d.date)).toEqual([
      "2025-03-04",
      "2025-03-05",
      "2025-03-06",
      "2025-03-07",
      "2025-03-08",
    ]);
  });

  it("accumulates the balance correctly", () => {
    const days = dailyBalances(account, movement, "2025-03-04", "2025-03-08");
    expect(days.map((d) => toDb(d.balance))).toEqual([
      "10000.00", // 04: no movement
      "12800.00", // 05: +2,500 +300
      "12800.00", // 06: no movement
      "11000.00", // 07: -1,800
      "11000.00", // 08: no movement
    ]);
  });

  it("separates inflow from outflow on the same day", () => {
    const mixed = [entry("2025-03-05", "2500.00"), entry("2025-03-05", "-400.00")];
    const day = dailyBalances(account, mixed, "2025-03-05", "2025-03-05")[0]!;

    expect(toDb(day.inflow)).toBe("2500.00");
    expect(toDb(day.outflow)).toBe("-400.00");
    expect(toDb(day.net)).toBe("2100.00");
    expect(day.entryCount).toBe(2);
  });

  it("starts from the running balance, not zero, when the window is later", () => {
    // The first row of the range already needs to reflect everything that
    // came before, or the evolution chart starts from the wrong place.
    const days = dailyBalances(account, movement, "2025-03-10", "2025-03-11");
    expect(toDb(days[0]!.balance)).toBe("11000.00");
  });

  it("crosses the month boundary without the date slipping", () => {
    const monthRollover = [entry("2025-03-31", "1000.00"), entry("2025-04-01", "-500.00")];
    const days = dailyBalances(account, monthRollover, "2025-03-30", "2025-04-02");

    expect(days.map((d) => d.date)).toEqual([
      "2025-03-30",
      "2025-03-31",
      "2025-04-01",
      "2025-04-02",
    ]);
    expect(days.map((d) => toDb(d.balance))).toEqual([
      "10000.00",
      "11000.00",
      "10500.00",
      "10500.00",
    ]);
  });

  it("keeps the opening balance when the window starts on the opening date itself", () => {
    // Regressao: a semente da soma corrida usava balanceOn(..., previousDay(start)),
    // e balanceOn() retorna 0 para qualquer data anterior a openingBalanceDate —
    // quando start == openingBalanceDate, previousDay(start) cai antes da
    // abertura, e o saldo inicial sumia de toda a janela (virava 0 em vez de
    // 10.000, mesmo sem nenhum movimento).
    const days = dailyBalances(account, [], "2025-01-01", "2025-01-03");
    expect(days.map((d) => toDb(d.balance))).toEqual(["10000.00", "10000.00", "10000.00"]);
  });

  it("keeps the opening balance when the window starts before the opening date", () => {
    // A janela pedida comeca ANTES da abertura da conta; a funcao ja clampa
    // `start` para openingBalanceDate ("2025-01-01"), entao os dias
    // retornados sao 01 e 02 — o ponto do teste e so confirmar que esse
    // clamp nao reintroduz o mesmo bug (saldo zerado no primeiro dia).
    const days = dailyBalances(account, [], "2024-12-30", "2025-01-02");
    expect(days.map((d) => d.date)).toEqual(["2025-01-01", "2025-01-02"]);
    expect(days.map((d) => toDb(d.balance))).toEqual(["10000.00", "10000.00"]);
  });
});

describe("consolidated balance", () => {
  it("sums the company's accounts", () => {
    const consolidated = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "2500.00"), entry("2025-03-10", "-1800.00")],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-06", "-200.00")],
      },
    ]);

    expect(toDb(consolidated.totalCurrent)).toBe("15500.00");
    expect(consolidated.perAccount.map((a) => toDb(a.current))).toEqual(["10700.00", "4800.00"]);
  });

  it("separates settled from projected", () => {
    const consolidated = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("1000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "500.00"), entry("2025-03-20", "-300.00", "previsto")],
      },
    ]);

    expect(toDb(consolidated.totalCurrent)).toBe("1500.00");
    expect(toDb(consolidated.totalProjected)).toBe("1200.00");
  });

  it("returns zero for a company with no registered account", () => {
    const consolidated = consolidate([]);
    expect(consolidated.totalCurrent).toBe(0);
    expect(consolidated.perAccount).toEqual([]);
  });
});

describe("a transfer between accounts creates no money and destroys none", () => {
  it("leaves the consolidated total unchanged", () => {
    // The property a spreadsheet breaks: moving 1,000 from Itaú to Bradesco
    // changes the balance of both accounts, but not the company's total.
    const before = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [],
      },
    ]);

    const after = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "-1000.00")],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "1000.00")],
      },
    ]);

    expect(after.totalCurrent).toBe(before.totalCurrent);
    expect(toDb(after.totalCurrent)).toBe("15000.00");
  });
});

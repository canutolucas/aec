/**
 * End-to-end domain test: a statement imported, reconciled against the
 * transactions and proved against the balance the bank itself declared.
 *
 * This is the tool's central claim — "the system's balance matches the
 * bank's" — actually verified, not just asserted.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  type CategorizationRule,
  categorize,
  currentBalance,
  divergences,
  fromDb,
  type MatchableTransaction,
  matchStatement,
  suggestRuleText,
  sum,
  toDb,
} from "@aec/domain";
import { describe, expect, it } from "vitest";

import { toMatchableLines } from "../src/universal/index";
import { parseOfx } from "../src/universal/ofx";

const statement = parseOfx(
  readFileSync(fileURLToPath(new URL("./fixtures/extrato-ofx1-sgml.ofx", import.meta.url)), "utf8"),
);

const ACCOUNT = {
  bankAccountId: "itau",
  openingBalance: fromDb("10000.00"),
  openingBalanceDate: "2025-03-01",
};

function transaction(
  id: string,
  bookingDate: string,
  amount: string,
  description: string,
): MatchableTransaction {
  return { id, bookingDate, amount: fromDb(amount), description };
}

describe("a month that closes", () => {
  // What the accounting firm booked during the month, in its own words.
  const booked = [
    transaction("t1", "2025-03-05", "2500.00", "Honorarios cliente Alfa"),
    transaction("t2", "2025-03-10", "-1800.00", "Aluguel marco"),
    transaction("t3", "2025-03-31", "-99.90", "Tarifa bancaria"),
  ];

  const result = matchStatement(toMatchableLines(statement), booked);

  it("reconciles everything, with nothing left over on either side", () => {
    expect(result.matched).toHaveLength(3);
    expect(result.unmatchedLines).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(0);
    expect(divergences(result)).toEqual([]);
  });

  it("matches even though the booked description doesn't look like the bank's memo", () => {
    // "Aluguel marco" against "PAGAMENTO BOLETO - IMOBILIARIA CENTRAL -
    // ALUGUEL MARCO": what holds the match together is amount and date, not the text.
    const rent = result.matched.find((m) => m.transactionId === "t2");
    expect(rent).toBeDefined();
    expect(rent!.dayGap).toBe(0);
  });

  it("the system's balance matches the balance the bank declared", () => {
    // The proof a spreadsheet never gave: not "checks out line by line", but
    // "the total is exactly this".
    const balance = currentBalance(
      ACCOUNT,
      booked.map((t) => ({
        bookingDate: t.bookingDate,
        amount: t.amount,
        status: "realizado" as const,
      })),
    );

    expect(toDb(balance)).toBe(toDb(statement.ledgerBalance!));
    expect(toDb(balance)).toBe("10600.10");
  });
});

describe("a month that doesn't close", () => {
  // The fee wasn't booked, and there's a booked payment the bank never registered.
  const booked = [
    transaction("t1", "2025-03-05", "2500.00", "Honorarios cliente Alfa"),
    transaction("t2", "2025-03-10", "-1800.00", "Aluguel marco"),
    transaction("t9", "2025-03-28", "-500.00", "Pagamento que nao saiu"),
  ];

  const result = matchStatement(toMatchableLines(statement), booked);
  const list = divergences(result);

  it("points out both divergences, each with its own kind", () => {
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.kind)).toEqual(["missing_in_statement", "missing_in_system"]);
  });

  it("says what still needs booking", () => {
    const needsBooking = list.find((d) => d.kind === "missing_in_system")!;
    expect(needsBooking.description).toContain("TARIFA");
    expect(toDb(needsBooking.amount)).toBe("-99.90");
  });

  it("says what was booked but the bank never registered", () => {
    const neverCleared = list.find((d) => d.kind === "missing_in_statement")!;
    expect(neverCleared.description).toBe("Pagamento que nao saiu");
    expect(toDb(neverCleared.amount)).toBe("-500.00");
  });

  it("the divergences explain exactly the difference between the two balances", () => {
    // This is what turns "it doesn't match" into "it doesn't match because
    // of these two transactions" — the difference between an afternoon of
    // reconciling and two minutes.
    const systemBalance = currentBalance(
      ACCOUNT,
      booked.map((t) => ({
        bookingDate: t.bookingDate,
        amount: t.amount,
        status: "realizado" as const,
      })),
    );

    const difference = statement.ledgerBalance! - systemBalance;
    const explanation = sum(
      list.map((d) => (d.kind === "missing_in_system" ? d.amount : -d.amount)),
    );

    expect(toDb(explanation)).toBe(toDb(difference));
    expect(toDb(difference)).toBe("400.10");
  });
});

describe("reconciliation feeds next month's categorization", () => {
  it("the rule proposed from the memo categorizes the following import", () => {
    // The cycle that makes reconciliation get cheaper every month: whoever
    // is operating categorizes once, the system saves the rule, and next
    // month the line already arrives classified.
    const marchRent = statement.lines.find((l) => l.memo.includes("IMOBILIARIA"))!;

    const ruleText = suggestRuleText(marchRent.memo);
    // Note what got left out: "pagamento" and "boleto" are jargon, and
    // "marco" is the month — a rule containing the month would stop
    // matching in April.
    expect(ruleText).toBe("imobiliaria central aluguel");

    const rules: CategorizationRule[] = [
      {
        id: "r-rent",
        matchText: ruleText,
        categoryId: "cat-rent",
        counterpartyId: "cp-landlord",
        priority: 100,
        isActive: true,
      },
    ];

    // April arrives with the bank's memo slightly different, as it always does.
    const aprilRent = {
      memo: "PAGAMENTO BOLETO - IMOBILIARIA CENTRAL - ALUGUEL ABRIL",
      amount: fromDb("-1800.00"),
      bankAccountId: "itau",
    };

    const classification = categorize(aprilRent, rules);
    expect(classification.categoryId).toBe("cat-rent");
    expect(classification.counterpartyId).toBe("cp-landlord");
  });
});

import { describe, expect, it } from "vitest";

import {
  divergences,
  type MatchableTransaction,
  matchStatement,
  normalizeText,
  type StatementLine,
  textSimilarity,
} from "../src/matching";
import { fromDb, toDb } from "../src/money";

function line(id: string, postedAt: string, amount: string, memo: string): StatementLine {
  return { id, postedAt, amount: fromDb(amount), memo };
}

function transaction(
  id: string,
  bookingDate: string,
  amount: string,
  description: string,
  documentNumber?: string,
): MatchableTransaction {
  return { id, bookingDate, amount: fromDb(amount), description, documentNumber };
}

describe("text normalization", () => {
  it("removes accent, punctuation and case", () => {
    expect(normalizeText("TED REC. JOÃO SILVA")).toBe("ted rec joao silva");
    expect(normalizeText("Pagamento  ALUGUEL/MARÇO")).toBe("pagamento aluguel marco");
  });

  it("handles an empty string", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });
});

describe("similarity between texts", () => {
  it("gives 1 for equal texts once normalized", () => {
    expect(textSimilarity("ALUGUEL MARCO", "aluguel março")).toBe(1);
  });

  it("gives 0 for texts with no word in common", () => {
    expect(textSimilarity("aluguel", "energia eletrica")).toBe(0);
  });

  it("gives an intermediate value for partial overlap", () => {
    const similarity = textSimilarity("pagamento aluguel marco", "aluguel marco");
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });

  it("ignores single-letter words, which would match anything", () => {
    expect(textSimilarity("a b c", "x y z")).toBe(0);
  });
});

describe("automatic matching", () => {
  it("matches an identical amount on the same date", () => {
    const result = matchStatement(
      [line("l1", "2025-03-05", "2500.00", "TED RECEBIDA CLIENTE")],
      [transaction("t1", "2025-03-05", "2500.00", "Honorarios marco")],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]).toMatchObject({ lineId: "l1", transactionId: "t1", dayGap: 0 });
    expect(result.unmatchedLines).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(0);
  });

  it("matches within the three-day tolerance", () => {
    // The real case: a payment made on Friday, cleared on Monday.
    const result = matchStatement(
      [line("l1", "2025-03-10", "-1800.00", "PAGTO BOLETO")],
      [transaction("t1", "2025-03-07", "-1800.00", "Aluguel marco")],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.dayGap).toBe(3);
  });

  it("never matches different amounts, no matter how similar the rest is", () => {
    const result = matchStatement(
      [line("l1", "2025-03-05", "2500.00", "Aluguel marco")],
      [transaction("t1", "2025-03-05", "2500.01", "Aluguel marco")],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
    expect(result.unmatchedLines).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  it("doesn't confuse an inflow with an outflow of the same magnitude", () => {
    const result = matchStatement(
      [line("l1", "2025-03-05", "500.00", "recebimento")],
      [transaction("t1", "2025-03-05", "-500.00", "pagamento")],
    );

    expect(result.matched).toHaveLength(0);
  });
});

describe("suggestion when the date is far off", () => {
  it("suggests instead of matching automatically", () => {
    // Matching this automatically would hide an error that would only show
    // up at closing time, when there's no longer a way to tell which match
    // was the wrong one.
    const result = matchStatement(
      [line("l1", "2025-03-25", "1000.00", "TED RECEBIDA")],
      [transaction("t1", "2025-03-05", "1000.00", "Recebimento cliente")],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0]!.dayGap).toBe(20);
    expect(result.suggested[0]!.reason).toContain("confirme antes de aceitar");
  });

  it("doesn't even suggest beyond the maximum window", () => {
    const result = matchStatement(
      [line("l1", "2025-06-05", "1000.00", "TED")],
      [transaction("t1", "2025-03-05", "1000.00", "Recebimento")],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.suggested).toHaveLength(0);
    expect(result.unmatchedLines).toHaveLength(1);
  });
});

describe("two payments of the same amount in the same month", () => {
  it("matches each with its closest counterpart, not swapped", () => {
    // The classic bug of naive reconciliation, which matches in the order it finds things.
    const result = matchStatement(
      [
        line("l-day-5", "2025-03-05", "-1000.00", "PAGTO FORNECEDOR"),
        line("l-day-20", "2025-03-20", "-1000.00", "PAGTO FORNECEDOR"),
      ],
      [
        transaction("t-day-20", "2025-03-20", "-1000.00", "Fornecedor parcela 2"),
        transaction("t-day-5", "2025-03-05", "-1000.00", "Fornecedor parcela 1"),
      ],
    );

    expect(result.matched).toHaveLength(2);
    const pairs = Object.fromEntries(result.matched.map((m) => [m.lineId, m.transactionId]));
    expect(pairs).toEqual({ "l-day-5": "t-day-5", "l-day-20": "t-day-20" });
  });

  it("doesn't reuse the same transaction across two lines", () => {
    const result = matchStatement(
      [
        line("l1", "2025-03-05", "-1000.00", "PAGTO"),
        line("l2", "2025-03-05", "-1000.00", "PAGTO"),
      ],
      [transaction("t1", "2025-03-05", "-1000.00", "Fornecedor")],
    );

    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedLines).toHaveLength(1);
    expect(result.unmatchedTransactions).toHaveLength(0);
  });
});

describe("document number in the memo", () => {
  it("makes the pair with the document beat a pair matched by date alone", () => {
    const result = matchStatement(
      [line("l1", "2025-03-10", "-1500.00", "PAGTO BOLETO 998877")],
      [
        transaction("t-no-doc", "2025-03-10", "-1500.00", "Fornecedor A"),
        transaction("t-with-doc", "2025-03-12", "-1500.00", "Fornecedor B", "998877"),
      ],
    );

    expect(result.matched[0]!.transactionId).toBe("t-with-doc");
    expect(result.matched[0]!.reason).toContain("número do documento");
  });
});

describe("divergences", () => {
  it("separates what still needs booking from what may not have happened", () => {
    const result = matchStatement(
      [
        line("l1", "2025-03-05", "2500.00", "TED RECEBIDA"),
        line("l2", "2025-03-08", "-99.90", "TARIFA MENSAL"),
      ],
      [
        transaction("t1", "2025-03-05", "2500.00", "Honorarios"),
        transaction("t2", "2025-03-09", "-450.00", "Pagamento que nao saiu"),
      ],
    );

    const list = divergences(result);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ kind: "missing_in_system", description: "TARIFA MENSAL" });
    expect(list[1]).toMatchObject({ kind: "missing_in_statement" });
  });

  it("the sum of the divergences explains the difference between the two balances", () => {
    // The property that turns "it doesn't match" into "it doesn't match because of these".
    const lines = [
      line("l1", "2025-03-05", "2500.00", "TED"),
      line("l2", "2025-03-08", "-99.90", "TARIFA"),
    ];
    const transactions = [
      transaction("t1", "2025-03-05", "2500.00", "Honorarios"),
      transaction("t2", "2025-03-09", "-450.00", "Pagamento pendente"),
    ];

    const statementBalance = lines.reduce((total, l) => total + l.amount, 0);
    const systemBalance = transactions.reduce((total, t) => total + t.amount, 0);

    const adjustment = divergences(matchStatement(lines, transactions)).reduce(
      (total, d) => total + (d.kind === "missing_in_system" ? d.amount : -d.amount),
      0,
    );

    expect(toDb(systemBalance + adjustment)).toBe(toDb(statementBalance));
  });

  it("returns an empty list when everything reconciles", () => {
    const result = matchStatement(
      [line("l1", "2025-03-05", "100.00", "x")],
      [transaction("t1", "2025-03-05", "100.00", "x")],
    );
    expect(divergences(result)).toEqual([]);
  });
});

describe("edge cases", () => {
  it("handles an empty statement", () => {
    const result = matchStatement([], [transaction("t1", "2025-03-05", "100.00", "x")]);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  it("handles an empty system", () => {
    const result = matchStatement([line("l1", "2025-03-05", "100.00", "x")], []);
    expect(result.unmatchedLines).toHaveLength(1);
  });

  it("accepts a custom tolerance", () => {
    const result = matchStatement(
      [line("l1", "2025-03-15", "100.00", "x")],
      [transaction("t1", "2025-03-05", "100.00", "x")],
      { exactDayTolerance: 10 },
    );
    expect(result.matched).toHaveLength(1);
  });
});

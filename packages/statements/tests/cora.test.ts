/**
 * Reader for Cora's PDF statement.
 *
 * Runs against an ANONYMIZED fixture generated from a real statement
 * (tests/local/gerar-fixture.test.ts): the geometry is the same —
 * coordinates, indents, column breaks, truncated names, reversed order,
 * four pages — but names, document numbers and amounts are fabricated. A
 * real statement carries the accounting firm's client list and doesn't go
 * into the repository.
 *
 * The layout reader is a pure function over lines, so these tests don't
 * need any binary PDF.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { categorize, fromDb, normalizeText, toDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { parseCoraLines } from "../src/node/cora";
import type { PdfLine } from "../src/node/pdf";
import { ImportError } from "../src/universal/types";

const lines = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/extrato-cora-linhas.json", import.meta.url)),
    "utf8",
  ),
) as PdfLine[];

const statement = parseCoraLines(lines);

describe("reading the statement", () => {
  it("reads every transaction across the four pages", () => {
    expect(statement.lines).toHaveLength(43);
    expect(statement.source).toBe("pdf");
  });

  it("drops the header and footer that repeat on every page", () => {
    // "pág 1 de 4", "Ouvidoria:", "Extrato gerado no dia" appear 4 times
    // each. One of them becoming a transaction would be an invented movement.
    const memos = statement.lines.map((line) => line.memo).join(" ");
    expect(memos).not.toMatch(/pág|Ouvidoria|Extrato gerado/i);
  });

  it("doesn't confuse the day-balance line with a transaction", () => {
    // "25/08/2026 Saldo do dia R$ 164.234,20" has a date and an amount,
    // just like a transaction. What separates them is the indent:
    // a transaction comes indented.
    expect(statement.lines.every((line) => !/Saldo do dia/i.test(line.memo))).toBe(true);
  });

  it("delivers in chronological order, even though the statement lists newest first", () => {
    const dates = statement.lines.map((line) => line.postedAt);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe("2026-08-01");
  });

  it("applies the sign from the amount's prefix", () => {
    const inflows = statement.lines.filter((line) => line.amount > 0);
    const outflows = statement.lines.filter((line) => line.amount < 0);
    expect(inflows.length).toBeGreaterThan(0);
    expect(outflows.length).toBeGreaterThan(0);
  });
});

describe("check against what the statement declares", () => {
  const integrity = statement.integrity!;

  it("matches the inflow and outflow totals", () => {
    expect(integrity.computedInflow).toBe(integrity.declaredInflow);
    expect(integrity.computedOutflow).toBe(integrity.declaredOutflow);
  });

  it("matches the closing balance", () => {
    expect(integrity.computedClosing).toBe(integrity.declaredClosing);
  });

  it("matches the balance for every single day", () => {
    // The strongest check this format allows: the statement prints each
    // day's balance, so it's possible to locate ON WHICH DAY the reading
    // diverged, instead of just knowing the total came out wrong.
    expect(integrity.dailyChecks).toHaveLength(15);
    expect(integrity.dailyChecks.every((check) => check.ok)).toBe(true);
  });

  it("concludes the statement is sound", () => {
    expect(integrity.problems).toEqual([]);
    expect(integrity.ok).toBe(true);
  });
});

describe("counterparty", () => {
  it("keeps the full CNPJ even when the name comes cut off", () => {
    // The reason this field exists: 27 of the 43 names arrive truncated,
    // but the document number comes in full. It's the stable key for
    // matching the counterparty.
    const truncated = statement.lines.filter((line) => line.nameTruncated);
    expect(truncated.length).toBeGreaterThan(20);
    expect(
      truncated.every((line) => /^\d{11}$|^\d{14}$/.test(line.counterpartyDocument ?? "")),
    ).toBe(true);
  });

  it("strips the ellipsis from the name, but records that it was cut off", () => {
    const truncatedLine = statement.lines.find((line) => line.nameTruncated)!;
    expect(truncatedLine.counterpartyName).not.toMatch(/…/);
    expect(truncatedLine.nameTruncated).toBe(true);
  });

  it("distinguishes CPF from CNPJ", () => {
    const documents = statement.lines.map((line) => line.counterpartyDocument);
    expect(documents.some((doc) => doc?.length === 14)).toBe(true);
    expect(documents.some((doc) => doc?.length === 11)).toBe(true);
  });

  it("warns about the truncated names and points to the better path", () => {
    expect(statement.warnings.join(" ")).toMatch(/nome cortado/);
    expect(statement.warnings.join(" ")).toMatch(/CNPJ\/CPF veio inteiro/);
  });

  it("carries type, name and document into the memo, which is what the rules scan", () => {
    const line = statement.lines.find((l) => l.counterpartyDocument !== undefined)!;
    expect(line.memo).toMatch(/Pagamento recebido|Boleto pago|Pix/i);
    expect(line.memo).toContain(line.counterpartyName!);
  });
});

describe("the period the statement actually attests to", () => {
  it("ends on the last day with a balance, not on the declared end", () => {
    // The statement says it covers 08/01 to 08/31, but was generated on the
    // 25th. Recording 08/31 would make the system treat August as covered,
    // and days 26 through 31 would never get charged to anyone.
    expect(statement.periodStart).toBe("2026-08-01");
    expect(statement.periodEnd).toBe("2026-08-25");
  });

  it("warns that the month is incomplete", () => {
    expect(statement.warnings.join(" ")).toMatch(/diz cobrir at[eé] 31\/08\/2026/);
    expect(statement.warnings.join(" ")).toMatch(/pe[cç]a o extrato do restante/);
  });
});

describe("deduplication", () => {
  it("generates a distinct key for each line", () => {
    const keys = new Set(statement.lines.map((line) => line.dedupKey));
    expect(keys.size).toBe(statement.lines.length);
  });

  it("produces the same keys when reprocessing the same file", () => {
    // The property that guarantees reimporting the statement never duplicates movement.
    const again = parseCoraLines(lines);
    expect(again.lines.map((l) => l.dedupKey)).toEqual(statement.lines.map((l) => l.dedupKey));
  });

  it("doesn't use a FITID, because PDF doesn't have one", () => {
    expect(statement.lines.every((line) => line.fitid === undefined)).toBe(true);
    expect(statement.lines.every((line) => line.dedupKey.startsWith("c:"))).toBe(true);
  });
});

describe("a wrong reading is detected, not silenced", () => {
  /** Removes one transaction, simulating a line the reader let slip through. */
  function withoutOneTransaction(): PdfLine[] {
    const target = lines.findIndex((line) => line.indent >= 45 && /[+-]\s*R\$/.test(line.text));
    return lines.filter((_, index) => index !== target);
  }

  it("flags it when a line goes missing", () => {
    // The worst failure mode of a PDF reader isn't crashing: it's reading
    // wrong and moving on. The balance would come out plausible and the
    // difference would only show up at closing time, when nobody connects
    // it back to the cause anymore.
    const broken = parseCoraLines(withoutOneTransaction());

    expect(broken.lines).toHaveLength(42);
    expect(broken.integrity!.ok).toBe(false);
    expect(broken.integrity!.problems.length).toBeGreaterThan(0);
    expect(broken.warnings.join(" ")).toMatch(/n[aã]o confere/);
  });

  it("says on which day the reading diverged", () => {
    const broken = parseCoraLines(withoutOneTransaction());
    const firstError = broken.integrity!.dailyChecks.find((check) => !check.ok);

    expect(firstError).toBeDefined();
    expect(firstError!.declared).not.toBe(firstError!.computed);
    expect(broken.integrity!.problems.join(" ")).toContain(firstError!.date);
  });

  it("flags it when an amount is misread", () => {
    const tampered = lines.map((line) =>
      line.text.includes("+ R$ 3.451,77")
        ? {
            ...line,
            text: line.text.replace("+ R$ 3.451,77", "+ R$ 3.451,78"),
            cells: line.cells.map((c) => ({
              ...c,
              text: c.text.replace("+ R$ 3.451,77", "+ R$ 3.451,78"),
            })),
          }
        : line,
    );

    const result = parseCoraLines(tampered);
    expect(result.integrity!.ok).toBe(false);
    // One cent is enough for the check to flag it.
    expect(result.integrity!.problems.join(" ")).toMatch(/Total de entradas n[aã]o confere/);
  });
});

describe("a file that doesn't work", () => {
  it("rejects a PDF from another bank, pointing to the path that works", () => {
    const other: PdfLine[] = [
      { page: 1, y: 700, indent: 30, text: "Banco Qualquer S.A.", cells: [] },
    ];
    expect(() => parseCoraLines(other)).toThrow(ImportError);
    expect(() => parseCoraLines(other)).toThrow(/exporte em OFX/);
  });

  it("rejects a Cora statement with no transaction at all", () => {
    const empty: PdfLine[] = [
      { page: 1, y: 700, indent: 30, text: "Cora SCFI - CNPJ 37.880.206/0001-63", cells: [] },
    ];
    expect(() => parseCoraLines(empty)).toThrow(/layout do extrato pode ter mudado/);
  });
});

describe("amounts", () => {
  it("reads the Brazilian format with a thousands separator", () => {
    const total = statement.lines.reduce((sum, line) => sum + line.amount, 0);
    expect(toDb(total)).toBe(
      toDb(statement.integrity!.computedInflow - statement.integrity!.computedOutflow),
    );
  });

  it("keeps the opening balance the statement declares", () => {
    expect(statement.openingBalance).toBe(fromDb("27800.45"));
  });
});

describe("the CNPJ saves the categorization a truncated name would break", () => {
  it("a rule by document matches even with the name cut off", () => {
    // The clincher: 27 of the 43 names arrive halfway, so a name-based rule
    // would be fragile. The document number comes in full and goes into
    // the memo, which is what the rules scan — categorization keeps working.
    const withDocument = statement.lines.find(
      (line) => line.nameTruncated && line.counterpartyDocument !== undefined,
    )!;

    const formattedCnpj = withDocument.memo.match(
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/,
    )![0];

    const classification = categorize(
      { memo: withDocument.memo, amount: withDocument.amount, bankAccountId: "cora" },
      [
        {
          id: "by-document",
          matchText: formattedCnpj,
          categoryId: "cat-sales",
          counterpartyId: "cp-client",
          priority: 10,
          isActive: true,
        },
      ],
    );

    expect(classification.categoryId).toBe("cat-sales");
    expect(classification.counterpartyId).toBe("cp-client");
  });

  it("a rule by document survives a change in punctuation", () => {
    // The statement prints "66.777.888/0001-36"; someone might register the
    // rule typing only the digits. Normalization has to treat both as equal.
    expect(normalizeText("66.777.888/0001-36")).toBe(normalizeText("66 777 888 0001 36"));
  });
});

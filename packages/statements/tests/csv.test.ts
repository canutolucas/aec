import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import {
  type CsvMapping,
  detectDelimiter,
  detectMapping,
  parseCsv,
  parseCsvDate,
  parseStatementCsv,
} from "../src/universal/csv";
import { ImportError } from "../src/universal/types";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("delimiter", () => {
  it("prefers the delimiter that gives consistent columns", () => {
    // Counting occurrences would get it wrong: a bank description has commas all the time.
    const content = 'Data;Historico;Valor\n05/03/2025;"COMPRA A, B E C";100,00\n';
    expect(detectDelimiter(content)).toBe(";");
  });

  it("recognizes a comma when it's the real delimiter", () => {
    expect(detectDelimiter("Data,Historico,Valor\n05/03/2025,COMPRA,100.00\n")).toBe(",");
  });

  it("recognizes a tab", () => {
    expect(detectDelimiter("Data\tHistorico\tValor\n05/03/2025\tCOMPRA\t100.00\n")).toBe("\t");
  });
});

describe("reading lines and fields", () => {
  it("respects quotes with the delimiter inside", () => {
    const lines = parseCsv('Data;Historico;Valor\n05/03/2025;"PAGTO A; B";100,00\n');
    expect(lines[1]).toEqual(["05/03/2025", "PAGTO A; B", "100,00"]);
  });

  it("understands doubled quotes inside a field", () => {
    const lines = parseCsv('a;b\n1;"diz ""ola"" aqui"\n');
    expect(lines[1]).toEqual(["1", 'diz "ola" aqui']);
  });

  it("accepts a CRLF line break and drops an empty line", () => {
    const lines = parseCsv("a;b\r\n1;2\r\n\r\n3;4\r\n");
    expect(lines).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("strips the BOM Excel writes at the start of the file", () => {
    const lines = parseCsv("﻿Data;Valor\n05/03/2025;100,00\n");
    expect(lines[0]![0]).toBe("Data");
  });
});

describe("CSV date", () => {
  it("reads the Brazilian format", () => {
    expect(parseCsvDate("05/03/2025")).toBe("2025-03-05");
    expect(parseCsvDate("5/3/2025")).toBe("2025-03-05");
    expect(parseCsvDate("05-03-2025")).toBe("2025-03-05");
    expect(parseCsvDate("05.03.2025")).toBe("2025-03-05");
  });

  it("reads ISO too", () => {
    expect(parseCsvDate("2025-03-05")).toBe("2025-03-05");
  });

  it("reads day then month in that order, without guessing", () => {
    // In "05/03/2025" both readings are valid. Picking the wrong one would
    // shift the whole month with nothing to catch it, so the rule is fixed:
    // dd/mm, the country's format.
    expect(parseCsvDate("05/03/2025")).toBe("2025-03-05");
    expect(parseCsvDate("12/01/2025")).toBe("2025-01-12");
  });

  it("expands a two-digit year", () => {
    expect(parseCsvDate("05/03/25")).toBe("2025-03-05");
    expect(parseCsvDate("05/03/99")).toBe("1999-03-05");
  });

  it("rejects a date that doesn't exist instead of shifting to the next month", () => {
    expect(() => parseCsvDate("31/02/2025")).toThrow(ImportError);
    expect(() => parseCsvDate("qualquer coisa")).toThrow(ImportError);
  });
});

describe("automatic mapping proposal", () => {
  const detected = detectMapping(fixture("extrato-colunas-valor-unico.csv"));

  it("skips the bank's header rows before the table", () => {
    expect(detected.mapping?.skipRows).toBe(3);
  });

  it("identifies the columns by their titles", () => {
    expect(detected.mapping).toMatchObject({
      dateColumn: 0,
      descriptionColumn: 1,
      documentColumn: 2,
      amountColumn: 3,
    });
    expect(detected.problems).toEqual([]);
  });

  it("identifies separate debit and credit columns", () => {
    const other = detectMapping(fixture("extrato-colunas-debito-credito.csv"));
    expect(other.mapping).toMatchObject({ debitColumn: 2, creditColumn: 3 });
    expect(other.mapping?.amountColumn).toBeUndefined();
  });

  it("admits it couldn't, instead of guessing a mapping", () => {
    // A wrong mapping imports the entire statement swapped, and the error
    // only shows up at closing time. Better to ask for the configuration
    // than to guess.
    const detected = detectMapping("linha sem nada util\noutra linha\n");
    expect(detected.mapping).toBeNull();
    expect(detected.problems.length).toBeGreaterThan(0);
  });
});

describe("statement with a single amount column", () => {
  const detected = detectMapping(fixture("extrato-colunas-valor-unico.csv"));
  const statement = parseStatementCsv(
    fixture("extrato-colunas-valor-unico.csv"),
    detected.mapping!,
  );

  it("imports the transactions and drops the closing-balance line", () => {
    // The "SALDO FINAL" footer isn't a transaction; summing it would double the statement.
    expect(statement.lines).toHaveLength(3);
    expect(statement.lines.map((l) => l.memo)).not.toContain("");
  });

  it("reads the amount in the Brazilian format, with the sign", () => {
    expect(statement.lines.map((l) => toDb(l.amount))).toEqual(["2500.00", "-1800.00", "-99.90"]);
  });

  it("reads the dates", () => {
    expect(statement.lines.map((l) => l.postedAt)).toEqual([
      "2025-03-05",
      "2025-03-10",
      "2025-03-31",
    ]);
    expect(statement.periodStart).toBe("2025-03-05");
    expect(statement.periodEnd).toBe("2025-03-31");
  });

  it("captures the document number", () => {
    expect(statement.lines[0]!.checkNumber).toBe("000123");
    expect(statement.lines[2]!.checkNumber).toBeUndefined();
  });

  it("generates a deduplication key even with no bank identifier", () => {
    expect(statement.lines.every((l) => l.dedupKey.startsWith("c:"))).toBe(true);
    expect(new Set(statement.lines.map((l) => l.dedupKey)).size).toBe(3);
  });
});

describe("statement with debit and credit in separate columns", () => {
  const detected = detectMapping(fixture("extrato-colunas-debito-credito.csv"));
  const statement = parseStatementCsv(
    fixture("extrato-colunas-debito-credito.csv"),
    detected.mapping!,
  );

  it("applies the sign from the column, not from the number", () => {
    // The value comes with no sign; it's the column that says inflow or outflow.
    expect(statement.lines.map((l) => toDb(l.amount))).toEqual(["1500.50", "-320.75", "-450.00"]);
  });

  it("preserves comma and quotes inside the description", () => {
    expect(statement.lines[0]!.memo).toBe("PIX RECEBIDO JOAO, MARIA ME");
    expect(statement.lines[2]!.memo).toBe('PAGTO "FORNECEDOR X" LTDA');
  });

  it("rejects a line with both a debit and a credit value", () => {
    const content = "Data,Lancamento,Debito,Credito\n05/03/2025,CONFUSA,100.00,50.00\n";
    const statement = parseStatementCsv(content, {
      delimiter: ",",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    });

    expect(statement.lines).toHaveLength(0);
    expect(statement.warnings[0]).toContain("debito e em credito");
  });
});

describe("manual mapping", () => {
  const mapping: CsvMapping = {
    delimiter: ";",
    hasHeader: true,
    dateColumn: "Data",
    descriptionColumn: "Historico",
    amountColumn: "Valor",
  };

  it("accepts a column referenced by title", () => {
    const statement = parseStatementCsv(
      "Data;Historico;Valor\n05/03/2025;COMPRA;-100,00\n",
      mapping,
    );
    expect(toDb(statement.lines[0]!.amount)).toBe("-100.00");
  });

  it("flips the sign when the bank exports an outflow as positive", () => {
    const statement = parseStatementCsv("Data;Historico;Valor\n05/03/2025;COMPRA;100,00\n", {
      ...mapping,
      invertSign: true,
    });
    expect(toDb(statement.lines[0]!.amount)).toBe("-100.00");
  });
});

describe("a problem file", () => {
  it("skips the broken line and imports the rest, warning about it", () => {
    const content =
      "Data;Historico;Valor\n" +
      "05/03/2025;BOA;100,00\n" +
      "31/02/2025;DATA INEXISTENTE;50,00\n" +
      "10/03/2025;OUTRA BOA;-25,00\n";

    const statement = parseStatementCsv(content, {
      delimiter: ";",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    });

    expect(statement.lines).toHaveLength(2);
    expect(statement.warnings).toHaveLength(1);
    expect(statement.warnings[0]).toContain("Linha 3");
  });

  it("rejects a file with no transaction line at all", () => {
    expect(() =>
      parseStatementCsv("Data;Historico;Valor\n", {
        delimiter: ";",
        hasHeader: true,
        dateColumn: 0,
        descriptionColumn: 1,
        amountColumn: 2,
      }),
    ).toThrow(ImportError);
  });

  it("warns about identical transactions, a limitation inherent to CSV", () => {
    // Without a bank identifier there's no way to distinguish two identical
    // transactions on a reimport. The warning is honest about that, instead
    // of pretending CSV is as reliable as OFX.
    const content = "Data;Historico;Valor\n05/03/2025;PEDAGIO;-50,00\n05/03/2025;PEDAGIO;-50,00\n";

    const statement = parseStatementCsv(content, {
      delimiter: ";",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    });

    expect(statement.lines).toHaveLength(2);
    expect(statement.lines[0]!.dedupKey).not.toBe(statement.lines[1]!.dedupKey);
    expect(statement.warnings.join(" ")).toContain("Prefira o OFX");
  });
});

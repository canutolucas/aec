import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { toDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { decodeOfx, parseOfx, parseOfxAmount, parseOfxDate } from "../src/universal/ofx";
import { ImportError } from "../src/universal/types";

function fixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");
}

describe("OFX date", () => {
  it("reads the short format", () => {
    expect(parseOfxDate("20250305")).toBe("2025-03-05");
  });

  it("uses the bank's local date and doesn't convert the timezone", () => {
    // The bug this test locks down: treating "20250301000000[-3:BRT]" as an
    // instant and formatting it afterward would push the March 1st
    // transaction to February 28th of the previous month, and the month
    // would close wrong.
    expect(parseOfxDate("20250301000000[-3:BRT]")).toBe("2025-03-01");
    expect(parseOfxDate("20250301120000[-3:BRT]")).toBe("2025-03-01");
    expect(parseOfxDate("20250101000000[-3:BRT]")).toBe("2025-01-01");
  });

  it("rejects an invalid date instead of inventing one", () => {
    expect(() => parseOfxDate("2025-03-05")).toThrow(ImportError);
    expect(() => parseOfxDate("20250230")).toThrow(ImportError);
    expect(() => parseOfxDate("")).toThrow(ImportError);
  });
});

describe("OFX amount", () => {
  it("reads the spec's format, with a decimal dot", () => {
    expect(toDb(parseOfxAmount("2500.00"))).toBe("2500.00");
    expect(toDb(parseOfxAmount("-1800.00"))).toBe("-1800.00");
    expect(toDb(parseOfxAmount("+99.90"))).toBe("99.90");
  });

  it("accepts a decimal comma, which some Brazilian exporters emit", () => {
    expect(toDb(parseOfxAmount("2500,00"))).toBe("2500.00");
    expect(toDb(parseOfxAmount("-1.800,50"))).toBe("-1800.50");
  });

  it("resolves both separators by the last one", () => {
    expect(toDb(parseOfxAmount("1,800.50"))).toBe("1800.50");
    expect(toDb(parseOfxAmount("1.800,50"))).toBe("1800.50");
  });

  it("rejects garbage instead of silently returning zero", () => {
    for (const value of ["", "abc", "R$", "1.2.3,4,5"]) {
      expect(() => parseOfxAmount(value), value).toThrow(ImportError);
    }
  });
});

describe("OFX 1.x in SGML (what Brazilian banks export)", () => {
  const statement = parseOfx(fixture("extrato-ofx1-sgml.ofx"));

  it("reads leaf tags with no closing tag", () => {
    expect(statement.lines).toHaveLength(3);
  });

  it("identifies bank, account and period", () => {
    expect(statement.bankId).toBe("341");
    expect(statement.accountId).toBe("56789-0");
    expect(statement.periodStart).toBe("2025-03-01");
    expect(statement.periodEnd).toBe("2025-03-31");
  });

  it("captures the balance the bank declares", () => {
    // Without this, reconciliation only compares line by line and never
    // asserts the total is correct.
    expect(toDb(statement.ledgerBalance!)).toBe("10600.10");
    expect(statement.ledgerBalanceDate).toBe("2025-03-31");
  });

  it("reads amounts with the correct sign", () => {
    expect(statement.lines.map((l) => toDb(l.amount))).toEqual(["2500.00", "-1800.00", "-99.90"]);
  });

  it("joins NAME and MEMO, which banks fill inconsistently", () => {
    expect(statement.lines[0]!.memo).toBe("TED RECEBIDA - CLIENTE ALFA COMERCIO LTDA");
    expect(statement.lines[2]!.memo).toBe("TARIFA MANUTENCAO CONTA");
  });

  it("uses the bank's FITID as the deduplication key", () => {
    expect(statement.lines[0]!.fitid).toBe("2025030500001");
    expect(statement.lines[0]!.dedupKey).toBe("fitid:2025030500001");
  });

  it("doesn't flag a problem on a well-formed file", () => {
    expect(statement.warnings).toEqual([]);
  });

  it("reimporting the same file produces exactly the same keys", () => {
    // The property that guarantees reimporting never duplicates movement.
    const again = parseOfx(fixture("extrato-ofx1-sgml.ofx"));
    expect(again.lines.map((l) => l.dedupKey)).toEqual(statement.lines.map((l) => l.dedupKey));
  });
});

describe("OFX 2.x in XML", () => {
  const statement = parseOfx(fixture("extrato-ofx2-xml.ofx"));

  it("reads the same content with the same code", () => {
    expect(statement.lines).toHaveLength(2);
    expect(statement.bankId).toBe("237");
    expect(statement.accountId).toBe("0001234567");
  });

  it("doesn't get confused by the leaves' closing tags", () => {
    // In XML, `</TRNAMT>` closes a leaf. Treating that as closing a
    // container would end `<STMTTRN>` too early and drop fields.
    expect(statement.lines[1]).toMatchObject({
      postedAt: "2025-04-15",
      fitid: "ABC-002",
      checkNumber: "000123",
    });
    expect(toDb(statement.lines[1]!.amount)).toBe("-320.75");
  });

  it("decodes XML entities in the memo", () => {
    expect(statement.lines[0]!.memo).toBe("PIX RECEBIDO JOAO & MARIA ME");
  });

  it("reads the declared balance", () => {
    expect(toDb(statement.ledgerBalance!)).toBe("1179.75");
  });
});

describe("character encoding", () => {
  it("reads an accent from a CHARSET:1252 file without corrupting the memo", () => {
    // Reading a 1252 file as UTF-8 turns an accented "JOSE" into garbage,
    // and the memo is exactly what feeds the categorization rules.
    const header = "OFXHEADER:100\nVERSION:102\nCHARSET:1252\n\n";
    const body =
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN>" +
      "<DTPOSTED>20250305<TRNAMT>-100.00<FITID>X1<MEMO>PAGAMENTO JOSÉ MÁRCIO" +
      "</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

    // Builds the bytes in windows-1252: each character becomes one byte.
    const text = header + body;
    const bytes = Uint8Array.from([...text].map((char) => char.charCodeAt(0)));

    expect(decodeOfx(bytes)).toContain("JOSÉ MÁRCIO");
    expect(parseOfx(bytes).lines[0]!.memo).toBe("PAGAMENTO JOSÉ MÁRCIO");
  });

  it("reads a UTF-8 file declared in the XML", () => {
    const text =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20250305</DTPOSTED>" +
      "<TRNAMT>-100.00</TRNAMT><FITID>X1</FITID><MEMO>PAGAMENTO JOSÉ</MEMO>" +
      "</STMTTRN></BANKTRANLIST></OFX>";
    const bytes = new TextEncoder().encode(text);

    expect(parseOfx(bytes).lines[0]!.memo).toBe("PAGAMENTO JOSÉ");
  });
});

describe("a problem file", () => {
  it("rejects a file that isn't OFX, with an actionable message", () => {
    expect(() => parseOfx("isto nao e um extrato")).toThrow(ImportError);
    expect(() => parseOfx("isto nao e um extrato")).toThrow(/download do banco/);
  });

  it("skips the broken transaction and imports the rest, warning about it", () => {
    // Losing the whole statement over one bad line would be worse than
    // importing what works and pointing out what was left out.
    const content =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>100.00<FITID>OK1<MEMO>BOA</STMTTRN>" +
      "<STMTTRN><DTPOSTED>20250306<TRNAMT>xxx<FITID>RUIM<MEMO>QUEBRADA</STMTTRN>" +
      "<STMTTRN><TRNAMT>50.00<FITID>SEMDATA<MEMO>SEM DATA</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const statement = parseOfx(content);

    expect(statement.lines).toHaveLength(1);
    expect(statement.lines[0]!.fitid).toBe("OK1");
    expect(statement.warnings).toHaveLength(2);
    expect(statement.warnings[0]).toContain("ignorada");
  });

  it("warns when the bank didn't send a FITID", () => {
    const content =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>100.00<MEMO>SEM FITID</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const statement = parseOfx(content);
    expect(statement.warnings.join(" ")).toContain("sem FITID");
    expect(statement.lines[0]!.dedupKey).toMatch(/^c:2025-03-05/);
  });

  it("accepts a statement with no transaction in the period", () => {
    const statement = parseOfx(
      "<OFX><BANKTRANLIST><DTSTART>20250301<DTEND>20250331</BANKTRANLIST></OFX>",
    );
    expect(statement.lines).toEqual([]);
    expect(statement.periodStart).toBe("2025-03-01");
  });
});

describe("deduplication without a FITID", () => {
  it("preserves two identical transactions on the same day", () => {
    // Two equal installments from the same supplier on the same day do
    // happen. Dropping the second as a duplicate would make the statement
    // end up off by that amount — exactly the problem the import exists to solve.
    const content =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>-50.00<MEMO>PEDAGIO</STMTTRN>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>-50.00<MEMO>PEDAGIO</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const statement = parseOfx(content);

    expect(statement.lines).toHaveLength(2);
    expect(statement.lines[0]!.dedupKey).not.toBe(statement.lines[1]!.dedupKey);
  });
});

/**
 * Cases learned from a real OFX file from Cora.
 *
 * The fixture is anonymized (generated by tests/local/gerar-fixture-ofx.test.ts)
 * but preserves what characterizes the bank's file: SGML header with
 * XML-style closing tags, ENCODING:UTF-8 with no CHARSET, DTSERVER earlier
 * than DTEND, FITID as a UUID, and memo in the "type - name - document" format.
 */
describe("a real OFX file from Cora", () => {
  const statement = parseOfx(fixture("extrato-cora.ofx"));

  it("reads the hybrid dialect: SGML header with closed tags", () => {
    // The file declares DATA:OFXSGML and VERSION:102, but closes every tag
    // like XML. Neither the purely-SGML path nor the purely-XML one would
    // handle it alone.
    expect(statement.lines).toHaveLength(43);
    expect(statement.bankId).toBe("0403");
    expect(statement.accountId).toBe("12345678");
  });

  it("respects ENCODING:UTF-8 declared with no CHARSET", () => {
    const withAccent = statement.lines.filter((line) => /[áéíóúâêôãõç]/i.test(line.memo));
    expect(withAccent.length).toBeGreaterThan(0);
  });

  it("preserves a bare & in the memo, which is valid in SGML", () => {
    // In XML, a bare & would be an error. In SGML it isn't, and the bank writes it that way.
    expect(statement.lines.some((line) => line.memo.includes(" & "))).toBe(true);
  });

  it("uses the FITID as the deduplication key, with no collision", () => {
    expect(statement.lines.every((line) => line.dedupKey.startsWith("fitid:"))).toBe(true);
    expect(new Set(statement.lines.map((l) => l.dedupKey)).size).toBe(43);
  });

  it("doesn't shift the date because of the declared timezone", () => {
    // Dates come as 20260801000000[0:GMT]. Midnight GMT is 9pm the PREVIOUS
    // day in Brazil: treating it as an instant would push every transaction
    // one day back and the month would close wrong.
    expect(
      statement.lines.map((l) => l.postedAt).every((d) => d >= "2026-08-01" && d <= "2026-08-31"),
    ).toBe(true);
    expect(statement.lines.some((line) => line.postedAt === "2026-08-01")).toBe(true);
  });
});

describe("the period the OFX actually attests to", () => {
  const statement = parseOfx(fixture("extrato-cora.ofx"));

  it("cuts the period at the generation date, not at the declared DTEND", () => {
    // The file declares DTEND on 08/31 and LEDGERBAL with DTASOF on 08/31,
    // but was generated on 08/25 — it can't contain what hasn't happened
    // yet. Recording 08/31 would make the system treat August as covered,
    // and days 26 through 31 would never get charged to anyone.
    expect(statement.periodStart).toBe("2026-08-01");
    expect(statement.periodEnd).toBe("2026-08-25");
    expect(statement.ledgerBalanceDate).toBe("2026-08-25");
  });

  it("warns that the declared period wasn't covered", () => {
    expect(statement.warnings.join(" ")).toMatch(/diz cobrir at[eé] 31\/08\/2026/);
    expect(statement.warnings.join(" ")).toMatch(/pe[cç]a o extrato do restante/);
  });

  it("cuts by the generation date, not by the last transaction", () => {
    // The difference matters: no movement between the 21st and the 25th is
    // legitimate information from the statement, not a gap. Cutting at the
    // last transaction would shrink the covered period for no reason.
    const last = statement.lines[statement.lines.length - 1]!.postedAt;
    expect(statement.periodEnd).toBe("2026-08-25");
    expect(statement.periodEnd! >= last).toBe(true);
  });

  it("keeps DTEND when the file was generated after the end of the period", () => {
    const complete = fixture("extrato-cora.ofx").replace(
      "<DTSERVER>20260825172645[0:GMT]</DTSERVER>",
      "<DTSERVER>20260901090000[0:GMT]</DTSERVER>",
    );
    const statement = parseOfx(complete);

    expect(statement.periodEnd).toBe("2026-08-31");
    expect(statement.warnings.join(" ")).not.toMatch(/diz cobrir at[eé]/);
  });
});

describe("counterparty from the memo", () => {
  const statement = parseOfx(fixture("extrato-cora.ofx"));

  it("extracts the CNPJ or CPF the bank wrote in the history", () => {
    // A document number in the memo is unambiguous for any bank, so it's
    // always worth looking for. It's the most reliable counterparty key:
    // it doesn't change, doesn't abbreviate and doesn't come truncated like
    // the name does in the PDF.
    expect(statement.lines.every((line) => line.counterpartyDocument !== undefined)).toBe(true);
    expect(
      statement.lines.every((line) => /^\d{11}$|^\d{14}$/.test(line.counterpartyDocument!)),
    ).toBe(true);
  });

  it("distinguishes CPF from CNPJ", () => {
    const lengths = new Set(statement.lines.map((l) => l.counterpartyDocument!.length));
    expect(lengths.has(14)).toBe(true);
    expect(lengths.has(11)).toBe(true);
  });

  it("doesn't invent a document number when the memo has none", () => {
    const noDocument = parseOfx(
      "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20250305<TRNAMT>-100.00<FITID>X1" +
        "<MEMO>TARIFA MENSAL</STMTTRN></BANKTRANLIST></OFX>",
    );
    expect(noDocument.lines[0]!.counterpartyDocument).toBeUndefined();
  });

  it("doesn't extract the name, since every bank formats it its own way", () => {
    // Cutting the name out by position would work for Cora and fail for the
    // others. The document number is generic; the name isn't.
    expect(statement.lines.every((line) => line.counterpartyName === undefined)).toBe(true);
  });
});

describe("what an OFX can and can't prove", () => {
  const statement = parseOfx(fixture("extrato-cora.ofx"));

  it("declares the closing balance, but not the opening one", () => {
    // Without a starting balance, the file can't prove on its own that no
    // transaction was lost — it only asserts a total. That's less than what
    // a PDF allows checking.
    expect(statement.ledgerBalance).toBeDefined();
    expect(statement.integrity!.dailyChecks).toEqual([]);
  });

  it("records the implied opening balance, for the application to cross-check", () => {
    // Closing balance minus the movement read = the balance the account
    // had on the eve. The application compares against the balance it
    // already has; if it matches, the statement is sound. It's the same
    // check the PDF does, just closed from the outside.
    const integrity = statement.integrity!;
    const movement = integrity.computedInflow - integrity.computedOutflow;

    expect(integrity.declaredOpening).toBe(integrity.declaredClosing! - movement);
    expect(toDb(integrity.declaredOpening!)).toBe("2780.45");
  });
});

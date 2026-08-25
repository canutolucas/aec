/**
 * Generates the anonymized OFX fixture from the real file.
 *
 * Preserves everything that characterizes the bank's file — SGML header
 * with XML-style closing tags, ENCODING:UTF-8 with no CHARSET, DTSERVER
 * earlier than DTEND, FITID as a UUID, memo in the "type - name -
 * document" format, accented characters and a bare `&` — and swaps out the
 * account, identifiers, names, documents and amounts.
 *
 * As with the PDF generator, the list of what needs to be swapped is
 * DERIVED from the file itself: writing it by hand would mean pasting real
 * data here, and this file is versioned.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const source = fileURLToPath(new URL("./extrato-cora.ofx", import.meta.url));
const destination = fileURLToPath(new URL("../fixtures/extrato-cora.ofx", import.meta.url));

const NAMES = [
  "Padaria Aurora Ltda",
  "Marcenaria Ponte Nova Ltda",
  "Clinica Sao Rafael Ltda",
  "Transportes Vale Verde Ltda",
  "Grafica Horizonte Ltda",
  "Mercado Bom Jardim Ltda",
  "Oficina Roda Livre Ltda",
  "Escola Girassol S S Ltda",
  "Farmacia Bela Flor Ltda",
  "Construtora Pedra Alta Ltda",
  "Hotel Mirante Azul Ltda",
  "Lavanderia Agua Clara Ltda",
  "Restaurante Forno Antigo Ltda",
  "Papelaria Estrela Ltda",
  "Academia Passo Firme Ltda",
  "Solucoes Integradas Aracaju Ltda",
  "Assistência De Benefícios Uniao Ltda",
  "Kowalski & Nunes Advogados Associados",
  "Joana Ribeiro Amaral",
  "Paulo Serra Machado",
];

const CNPJS = [
  "11.222.333/0001-81",
  "22.333.444/0001-72",
  "33.444.555/0001-63",
  "44.555.666/0001-54",
  "55.666.777/0001-45",
  "66.777.888/0001-36",
  "77.888.999/0001-27",
  "88.999.111/0001-18",
  "99.111.222/0001-09",
  "10.203.040/0001-90",
  "20.304.050/0001-81",
  "30.405.060/0001-72",
  "40.506.070/0001-63",
  "50.607.080/0001-54",
  "60.708.090/0001-45",
  "70.809.010/0001-36",
];
const CPFS = ["123.456.789-09", "234.567.890-12", "345.678.901-23"];

function seed(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function fakeUuid(base: string): string {
  const hex = (n: number, size: number) =>
    (seed(base + n).toString(16) + "0".repeat(size)).slice(0, size);
  return `${hex(1, 8)}-${hex(2, 4)}-4${hex(3, 3)}-a${hex(4, 3)}-${hex(5, 12)}`;
}

const DOCUMENT = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/;

describe.skipIf(!existsSync(source))("anonymized OFX fixture generation", () => {
  it("generates tests/fixtures/extrato-cora.ofx with no real data", () => {
    const original = readFileSync(source, "utf8");

    // Fabricated amounts, in the order the transactions appear.
    const originalAmounts = [...original.matchAll(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g)];
    const newAmounts = originalAmounts.map(([, amount]) => {
      const negative = amount!.startsWith("-");
      const magnitude = 10000 + (seed(amount! + originalAmounts.length) % 900000);
      return (negative ? -magnitude : magnitude) / 100;
    });

    let amountIndex = 0;
    let output = original;

    output = output
      .replace(/<ACCTID>[^<]+<\/ACCTID>/g, "<ACCTID>12345678</ACCTID>")
      .replace(/<FITID>([^<]+)<\/FITID>/g, (_whole, id: string) => `<FITID>${fakeUuid(id)}</FITID>`)
      .replace(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g, () => {
        const replacement = newAmounts[amountIndex++]!;
        return `<TRNAMT>${replacement.toFixed(2)}</TRNAMT>`;
      })
      .replace(/<MEMO>([^<]*)<\/MEMO>/g, (_whole, memo: string) => {
        // Cora's memo is "type - name - document". Only the type is kept.
        const parts = memo.split(" - ");
        const type = parts[0]!;
        const originalDocument = DOCUMENT.exec(memo)?.[0];
        const list = originalDocument?.includes("/") ? CNPJS : CPFS;
        const document = list[seed(memo) % list.length]!;
        const name = NAMES[seed(memo + "n") % NAMES.length]!;
        return `<MEMO>${type} - ${name} - ${document}</MEMO>`;
      });

    // Closing balance recomputed from a fabricated opening balance, so the
    // integrity check has something to verify.
    const OPENING_BALANCE = 2780.45;
    const movement = newAmounts.reduce((total, amount) => total + amount, 0);
    const closingBalance = Math.round((OPENING_BALANCE + movement) * 100) / 100;
    output = output.replace(
      /<BALAMT>[^<]+<\/BALAMT>/,
      `<BALAMT>${closingBalance.toFixed(2)}</BALAMT>`,
    );

    // --- leak check, derived from the file itself ---
    const sensitive = new Set<string>();
    for (const [, document] of original.matchAll(
      /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/g,
    )) {
      sensitive.add(document!);
    }
    for (const [, id] of original.matchAll(/<FITID>([^<]+)<\/FITID>/g)) sensitive.add(id!);
    for (const [, amount] of original.matchAll(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g))
      sensitive.add(amount!);
    for (const [, amount] of original.matchAll(/<BALAMT>([^<]+)<\/BALAMT>/g))
      sensitive.add(amount!);
    for (const [, account] of original.matchAll(/<ACCTID>([^<]+)<\/ACCTID>/g))
      sensitive.add(account!);
    for (const [, memo] of original.matchAll(/<MEMO>([^<]*)<\/MEMO>/g)) {
      const name = memo!.split(" - ")[1];
      if (name) sensitive.add(name.trim());
    }

    expect(sensitive.size).toBeGreaterThan(80);

    for (const value of sensitive) {
      if (value.length < 5) continue;
      expect(output, `leaked "${value}" into the fixture`).not.toContain(value);
    }

    writeFileSync(destination, output);
    console.log(
      `\n  OFX fixture generated: ${newAmounts.length} transactions, ${sensitive.size} sensitive values checked`,
    );
  });
});

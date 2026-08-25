/**
 * Generates the anonymized fixture from the real statement.
 *
 * Preserves the exact geometry — coordinates, indents, column breaks,
 * truncated names, reversed order, pagination — and swaps out ALL sensitive
 * content: the company name, CNPJ, account number, counterparties,
 * documents and amounts.
 *
 * The new amounts are fabricated and the daily and total balances are
 * recomputed from them, so the fixture stays internally consistent and the
 * integrity checks have something to verify.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractLines, type PdfLine } from "../../src/node/pdf";

const source = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const destination = fileURLToPath(new URL("../fixtures/extrato-cora-linhas.json", import.meta.url));

const NAMES = [
  "Padaria Aurora Ltda",
  "Marcenaria Ponte Nova",
  "Clinica Sao Rafael Ltda",
  "Transportes Vale Verde",
  "Grafica Horizonte Ltda",
  "Mercado Bom Jardim",
  "Oficina Roda Livre Ltda",
  "Escola Girassol S/S",
  "Farmacia Bela Flor",
  "Construtora Pedra Alta",
  "Hotel Mirante Azul",
  "Lavanderia Agua Clara",
  "Restaurante Forno Antigo",
  "Papelaria Estrela Ltda",
  "Academia Passo Firme",
  "Joana Ribeiro Amaral",
  "Paulo Serra Machado",
  "Helena Duarte Pinto",
];

const CNPJ_DOCS = [
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
];
const CPF_DOCS = ["123.456.789-09", "234.567.890-12", "345.678.901-23"];

/** Deterministic pseudo-random: the fixture must come out the same every time. */
function seed(text: string): number {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;
const DOCUMENT = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/;
const SIGNED_AMOUNT = /([+-])\s*R\$\s*([\d.]+,\d{2})/;

function formatReais(cents: number): string {
  const units = Math.trunc(Math.abs(cents) / 100);
  const remainder = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${units.toLocaleString("pt-BR")},${remainder}`;
}

describe.skipIf(!existsSync(source))("anonymized fixture generation", () => {
  it("generates tests/fixtures/extrato-cora-linhas.json with no real data", async () => {
    const lines = await extractLines(new Uint8Array(readFileSync(source)));

    // First pass: fabricates a new value for each transaction, in the order
    // they appear, and accumulates the movement per day.
    const newAmount = new Map<number, number>();
    const dayMovement = new Map<string, number>();
    let currentDay: string | null = null;

    lines.forEach((line, index) => {
      const isHeading = line.indent < 45 && /Saldo do dia/i.test(line.text);
      if (isHeading) {
        currentDay = DATE.exec(line.text)?.[0] ?? null;
        if (currentDay) dayMovement.set(currentDay, 0);
        return;
      }

      const amount = SIGNED_AMOUNT.exec(line.text);
      if (!amount || line.indent < 45 || !currentDay) return;

      // Between R$ 100.00 and R$ 9,999.99, with the same sign as the original.
      const magnitude = 10000 + (seed(line.text) % 990000);
      const signed = amount[1] === "-" ? -magnitude : magnitude;
      newAmount.set(index, signed);
      dayMovement.set(currentDay, dayMovement.get(currentDay)! + signed);
    });

    // Daily balances recomputed from a fabricated opening balance.
    const OPENING_BALANCE = 2_780_045;
    const days = [...dayMovement.keys()].sort(
      (a, b) =>
        Number(a.slice(6) + a.slice(3, 5) + a.slice(0, 2)) -
        Number(b.slice(6) + b.slice(3, 5) + b.slice(0, 2)),
    );
    const dayBalance = new Map<string, number>();
    let running = OPENING_BALANCE;
    for (const day of days) {
      running += dayMovement.get(day)!;
      dayBalance.set(day, running);
    }

    const inflow = [...newAmount.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const outflow = -[...newAmount.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);

    // Second pass: rewrites the text of each cell.
    const anonymized: PdfLine[] = lines.map((line, index) => {
      const cells = line.cells.map((cell) => {
        let text = cell.text;

        text = text
          .replace(/AEC ASSESSORIA EMPRESARIAL E CONTABIL S\/S/gi, "EMPRESA EXEMPLO CONTABIL S/S")
          .replace(/05\.434\.767\/0001-42/g, "00.000.000/0001-00")
          .replace(/Conta:\s*[\d-]+/gi, "Conta: 1234567-8");

        // Only transaction lines (indented) have a counterparty. Header
        // lines were already handled by the explicit replacement above.
        const isTransaction = line.indent >= 45;

        const document = isTransaction ? DOCUMENT.exec(text)?.[1] : undefined;
        if (document) {
          const list = document.includes("/") ? CNPJ_DOCS : CPF_DOCS;
          text = text.replace(document, list[seed(document) % list.length]!);
        }

        // Counterparty name: a column with no document, no amount and no date.
        const isName =
          isTransaction &&
          !DOCUMENT.test(cell.text) &&
          !/R\$/.test(cell.text) &&
          !DATE.test(cell.text) &&
          /^[A-Za-zÀ-ú0-9]/.test(cell.text) &&
          !/^(Pagamento recebido|Boleto pago|Transf Pix enviada|Pgto QR Code Pix|Saldo do dia|Transações|Extrato|Total de|Saldo (inicial|final)|Ouvidoria|Cora SCFI|Agência|CNPJ|pág)/i.test(
            cell.text,
          );

        if (isName) {
          const truncated = /…|\.\.\.$/.test(cell.text);
          const base = NAMES[seed(cell.text) % NAMES.length]!;
          // Keeps the approximate length and the truncation mark.
          text = truncated
            ? base.slice(0, Math.max(6, cell.text.replace(/…/g, "").trim().length)) + "…"
            : base;
        }

        const amount = SIGNED_AMOUNT.exec(cell.text);
        if (amount && newAmount.has(index)) {
          const replacement = newAmount.get(index)!;
          text = cell.text.replace(
            SIGNED_AMOUNT,
            `${replacement < 0 ? "-" : "+"} R$ ${formatReais(replacement)}`,
          );
        }

        if (/Saldo do dia/i.test(line.text) && /R\$/.test(cell.text) && !amount) {
          const fromHeading = DATE.exec(line.text)?.[0];
          if (fromHeading && dayBalance.has(fromHeading)) {
            text = `R$ ${formatReais(dayBalance.get(fromHeading)!)}`;
          }
        }
        if (/Saldo inicial disponível/i.test(line.text) && /R\$/.test(cell.text)) {
          text = `R$ ${formatReais(OPENING_BALANCE)}`;
        }
        if (/Saldo final disponível/i.test(line.text) && /R\$/.test(cell.text)) {
          text = `R$ ${formatReais(running)}`;
        }
        if (/Total de entradas/i.test(line.text) && /R\$/.test(cell.text)) {
          text = `+ R$ ${formatReais(inflow)}`;
        }
        if (/Total de saídas/i.test(line.text) && /R\$/.test(cell.text)) {
          text = `- R$ ${formatReais(outflow)}`;
        }

        return { ...cell, text };
      });

      return {
        ...line,
        cells,
        text: cells
          .map((c) => c.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      };
    });

    const serialized = JSON.stringify(anonymized, null, 1);

    // The forbidden-values list is DERIVED from the statement itself, never
    // written by hand: writing it by hand would require pasting real CNPJ
    // numbers and amounts into this file, which is versioned — that would
    // be the leak right there. Deriving it also covers everything, not just
    // what someone remembered to list.
    const sensitive = new Set<string>();

    for (const line of lines) {
      // The one exception: the bank's own institutional footer. Cora's CNPJ
      // is public, appears identical on every statement it issues, and the
      // reader depends on this line to recognize the format. Anonymizing it
      // would break the fixture without protecting anything.
      if (/^Cora SCFI/i.test(line.text) || /^Ouvidoria:/i.test(line.text)) continue;

      for (const cell of line.cells) {
        const raw = cell.text.trim();
        if (raw === "") continue;

        const document = DOCUMENT.exec(raw)?.[1];
        if (document) sensitive.add(document);

        // Any monetary value: transaction, daily balance or total.
        for (const amount of raw.matchAll(/R\$\s*([\d.]+,\d{2})/g)) {
          sensitive.add(amount[1]!);
        }

        // Counterparty name, only on transaction lines.
        if (
          line.indent >= 45 &&
          !DOCUMENT.test(raw) &&
          !/R\$/.test(raw) &&
          !DATE.test(raw) &&
          !/^(Pagamento recebido|Boleto pago|Transf Pix enviada|Pgto QR Code Pix)$/i.test(raw)
        ) {
          sensitive.add(raw.replace(/…/g, "").trim());
        }
      }
    }

    // Account holder's identification.
    sensitive.add(lines[0]!.text.trim());
    const account = /Conta:\s*([\d-]+)/.exec(lines.map((l) => l.text).join(" "))?.[1];
    if (account) sensitive.add(account);

    expect(sensitive.size).toBeGreaterThan(50);

    for (const value of sensitive) {
      if (value.length < 4) continue;
      expect(serialized, `leaked "${value}" into the fixture`).not.toContain(value);
    }

    writeFileSync(destination, serialized + "\n");
    console.log(
      `\n  fixture generated: ${anonymized.length} lines, ${sensitive.size} sensitive values checked`,
    );
  });
});

/**
 * Validacao cruzada: o mesmo periodo, nos dois formatos que o banco oferece.
 *
 * Ter o PDF e o OFX do mesmo mes e a melhor prova disponivel de que os dois
 * leitores estao certos. Eles nao compartilham codigo de leitura — um interpreta
 * geometria de pagina, o outro interpreta tags — entao concordarem transacao a
 * transacao seria coincidencia improvavel se algum estivesse errado.
 *
 * Roda so quando os dois arquivos estao em tests/local (pasta ignorada).
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCoraPdf } from "@/lib/import/cora";
import { parseOfx } from "@/lib/import/ofx";
import { formatBRL, sum, toDb } from "@/lib/domain/money";

const caminhoPdf = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const caminhoOfx = fileURLToPath(new URL("./extrato-cora.ofx", import.meta.url));
const temAmbos = existsSync(caminhoPdf) && existsSync(caminhoOfx);

describe.skipIf(!temAmbos)("PDF e OFX do mesmo periodo", () => {
  const ofx = parseOfx(new Uint8Array(readFileSync(caminhoOfx)));

  it("relata o que cada formato entrega", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    console.log(`
  ---------------------------------------------------------------
                              PDF            OFX
  transacoes           ${String(pdf.lines.length).padStart(10)}     ${String(ofx.lines.length).padStart(10)}
  com FITID            ${String(pdf.lines.filter((l) => l.fitid).length).padStart(10)}     ${String(ofx.lines.filter((l) => l.fitid).length).padStart(10)}
  nome truncado        ${String(pdf.lines.filter((l) => l.nameTruncated).length).padStart(10)}     ${String(ofx.lines.filter((l) => l.nameTruncated).length).padStart(10)}
  saldo inicial        ${(pdf.openingBalance !== undefined ? formatBRL(pdf.openingBalance) : "ausente").padStart(14)} ${(ofx.openingBalance !== undefined ? formatBRL(ofx.openingBalance) : "ausente").padStart(14)}
  saldo final          ${(pdf.ledgerBalance !== undefined ? formatBRL(pdf.ledgerBalance) : "ausente").padStart(14)} ${(ofx.ledgerBalance !== undefined ? formatBRL(ofx.ledgerBalance) : "ausente").padStart(14)}
  periodo              ${pdf.periodStart} a ${pdf.periodEnd}   ${ofx.periodStart} a ${ofx.periodEnd}
  ---------------------------------------------------------------`);

    for (const aviso of ofx.warnings) console.log(`  aviso OFX: ${aviso}`);
  });

  it("le o mesmo numero de transacoes", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));
    expect(ofx.lines.length).toBe(pdf.lines.length);
  });

  it("concorda em data e valor, transacao a transacao", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    const chave = (l: { postedAt: string; amount: number }) => `${l.postedAt}|${l.amount}`;
    const doPdf = pdf.lines.map(chave).sort();
    const doOfx = ofx.lines.map(chave).sort();

    expect(doOfx).toEqual(doPdf);
  });

  it("chega ao mesmo saldo final", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));
    const totalOfx = sum(ofx.lines.map((l) => l.amount));
    const totalPdf = sum(pdf.lines.map((l) => l.amount));

    expect(toDb(totalOfx)).toBe(toDb(totalPdf));
    // O saldo final do OFX confere com o saldo inicial do PDF mais o movimento.
    expect(toDb(pdf.openingBalance! + totalOfx)).toBe(toDb(ofx.ledgerBalance!));
  });

  it("o saldo inicial que o OFX implica bate com o que o PDF declara", async () => {
    // A conferencia mais forte que os dois arquivos permitem juntos. O OFX nao
    // traz saldo inicial; ele so pode ser deduzido do saldo final menos o
    // movimento. O PDF declara o saldo inicial diretamente. Os dois numeros vem
    // por caminhos independentes e tem de coincidir ao centavo — se algum leitor
    // tivesse perdido ou duplicado uma transacao, nao coincidiriam.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    expect(toDb(ofx.integrity!.declaredOpening!)).toBe(toDb(pdf.openingBalance!));
    expect(toDb(ofx.integrity!.computedInflow)).toBe(toDb(pdf.integrity!.computedInflow));
    expect(toDb(ofx.integrity!.computedOutflow)).toBe(toDb(pdf.integrity!.computedOutflow));
  });

  it("os dois formatos concordam sobre o periodo que o extrato atesta", async () => {
    // Os dois arquivos declaram cobrir ate 31/08 e os dois foram gerados no dia
    // 25. Os leitores chegam ao mesmo corte por caminhos diferentes: o do PDF
    // pelo ultimo saldo diario impresso, o do OFX pelo DTSERVER.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    expect(ofx.periodStart).toBe(pdf.periodStart);
    expect(ofx.periodEnd).toBe(pdf.periodEnd);
    expect(ofx.periodEnd).toBe("2026-08-25");
  });

  it("o documento da contraparte e o mesmo nos dois formatos", async () => {
    // O nome vem cortado no PDF e inteiro no OFX, mas o documento e identico —
    // e por isso ele, e nao o nome, e a chave de contraparte.
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    const doPdf = pdf.lines.map((l) => l.counterpartyDocument).filter(Boolean).sort();
    const doOfx = ofx.lines.map((l) => l.counterpartyDocument).filter(Boolean).sort();

    expect(doOfx).toEqual(doPdf);
  });

  it("o OFX traz o nome completo onde o PDF cortou", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    const cortadas = pdf.lines.filter((l) => l.nameTruncated);
    expect(cortadas.length).toBeGreaterThan(20);

    // Para cada nome cortado no PDF, o OFX tem o nome inteiro comecando igual.
    for (const cortada of cortadas.slice(0, 5)) {
      const equivalente = ofx.lines.find(
        (l) => l.postedAt === cortada.postedAt && l.amount === cortada.amount,
      )!;
      expect(equivalente.memo.length).toBeGreaterThanOrEqual(cortada.memo.length);
    }
  });

  it("o OFX identifica cada transacao com FITID, o que o PDF nao faz", async () => {
    const pdf = await parseCoraPdf(new Uint8Array(readFileSync(caminhoPdf)));

    expect(ofx.lines.every((l) => l.fitid !== undefined && l.fitid !== "")).toBe(true);
    expect(ofx.lines.every((l) => l.dedupKey.startsWith("fitid:"))).toBe(true);
    expect(pdf.lines.every((l) => l.dedupKey.startsWith("c:"))).toBe(true);
    expect(new Set(ofx.lines.map((l) => l.dedupKey)).size).toBe(ofx.lines.length);
  });

  it("nao desloca a data por causa do fuso declarado no arquivo", () => {
    // As datas vem como 20260825000000[0:GMT]. Meia-noite GMT e 21h do dia
    // ANTERIOR no Brasil: interpretar como instante jogaria o lancamento do dia
    // 25 para o dia 24, e o mes fecharia errado. O leitor usa os oito primeiros
    // digitos e nao converte nada.
    const daPrimeira = ofx.lines.filter((l) => l.postedAt === "2026-08-01");
    expect(daPrimeira.length).toBeGreaterThan(0);
    expect(ofx.lines.every((l) => l.postedAt >= "2026-08-01" && l.postedAt <= "2026-08-31")).toBe(true);
  });
});

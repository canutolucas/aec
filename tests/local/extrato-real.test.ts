/**
 * Conferencia do leitor contra um extrato de verdade.
 *
 * Roda so quando ha um PDF em tests/local (pasta ignorada pelo git). Sem
 * arquivo, os testes se declaram pulados — o CI nao tem, e nem deve ter, extrato
 * real.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCoraPdf } from "@/lib/import/cora";
import { formatBRL } from "@/lib/domain/money";

const caminho = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const existe = existsSync(caminho);

describe.skipIf(!existe)("extrato real do Cora", () => {
  it("le, confere contra os totais declarados e bate todos os saldos diarios", async () => {
    const extrato = await parseCoraPdf(new Uint8Array(readFileSync(caminho)));
    const integridade = extrato.integrity!;

    // Relatorio legivel: e o que se olha quando a conferencia falha.
    console.log(`\n  periodo ................ ${extrato.periodStart} a ${extrato.periodEnd}`);
    console.log(`  transacoes lidas ....... ${extrato.lines.length}`);
    console.log(`  saldo inicial declarado  ${formatBRL(integridade.declaredOpening!)}`);
    console.log(`  entradas: declarado ${formatBRL(integridade.declaredInflow!)} | lido ${formatBRL(integridade.computedInflow)}`);
    console.log(`  saidas:   declarado ${formatBRL(integridade.declaredOutflow!)} | lido ${formatBRL(integridade.computedOutflow)}`);
    console.log(`  saldo final: declarado ${formatBRL(integridade.declaredClosing!)} | lido ${formatBRL(integridade.computedClosing!)}`);
    console.log(`  saldos diarios conferidos: ${integridade.dailyChecks.filter((c) => c.ok).length}/${integridade.dailyChecks.length}`);
    for (const problema of integridade.problems) console.log(`  PROBLEMA: ${problema}`);
    for (const aviso of extrato.warnings) console.log(`  aviso: ${aviso}`);

    expect(integridade.computedInflow).toBe(integridade.declaredInflow);
    expect(integridade.computedOutflow).toBe(integridade.declaredOutflow);
    expect(integridade.computedClosing).toBe(integridade.declaredClosing);
    expect(integridade.dailyChecks.every((check) => check.ok)).toBe(true);
    expect(integridade.problems).toEqual([]);
    expect(integridade.ok).toBe(true);
  });

  it("nao gera chave de deduplicacao repetida", async () => {
    const extrato = await parseCoraPdf(new Uint8Array(readFileSync(caminho)));
    const chaves = new Set(extrato.lines.map((linha) => linha.dedupKey));
    expect(chaves.size).toBe(extrato.lines.length);
  });

  it("entrega as transacoes em ordem cronologica", async () => {
    const extrato = await parseCoraPdf(new Uint8Array(readFileSync(caminho)));
    const datas = extrato.lines.map((linha) => linha.postedAt);
    expect(datas).toEqual([...datas].sort());
  });
});

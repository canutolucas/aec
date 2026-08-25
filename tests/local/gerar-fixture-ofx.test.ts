/**
 * Gera a fixture OFX anonimizada a partir do arquivo real.
 *
 * Preserva tudo que caracteriza o arquivo do banco — cabecalho SGML com tags de
 * fechamento no estilo XML, ENCODING:UTF-8 sem CHARSET, DTSERVER anterior ao
 * DTEND, FITID em UUID, memo no formato "tipo - nome - documento", acentuacao e
 * `&` cru — e troca conta, identificadores, nomes, documentos e valores.
 *
 * Como no gerador do PDF, a lista do que precisa ser trocado e DERIVADA do
 * proprio arquivo: escreve-la a mao exigiria colar dados reais aqui, e este
 * arquivo e versionado.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const origem = fileURLToPath(new URL("./extrato-cora.ofx", import.meta.url));
const destino = fileURLToPath(new URL("../fixtures/extrato-cora.ofx", import.meta.url));

const NOMES = [
  "Padaria Aurora Ltda", "Marcenaria Ponte Nova Ltda", "Clinica Sao Rafael Ltda",
  "Transportes Vale Verde Ltda", "Grafica Horizonte Ltda", "Mercado Bom Jardim Ltda",
  "Oficina Roda Livre Ltda", "Escola Girassol S S Ltda", "Farmacia Bela Flor Ltda",
  "Construtora Pedra Alta Ltda", "Hotel Mirante Azul Ltda", "Lavanderia Agua Clara Ltda",
  "Restaurante Forno Antigo Ltda", "Papelaria Estrela Ltda", "Academia Passo Firme Ltda",
  "Solucoes Integradas Aracaju Ltda", "Assistência De Benefícios Uniao Ltda",
  "Kowalski & Nunes Advogados Associados", "Joana Ribeiro Amaral", "Paulo Serra Machado",
];

const CNPJS = [
  "11.222.333/0001-81", "22.333.444/0001-72", "33.444.555/0001-63", "44.555.666/0001-54",
  "55.666.777/0001-45", "66.777.888/0001-36", "77.888.999/0001-27", "88.999.111/0001-18",
  "99.111.222/0001-09", "10.203.040/0001-90", "20.304.050/0001-81", "30.405.060/0001-72",
  "40.506.070/0001-63", "50.607.080/0001-54", "60.708.090/0001-45", "70.809.010/0001-36",
];
const CPFS = ["123.456.789-09", "234.567.890-12", "345.678.901-23"];

function semente(texto: string): number {
  let hash = 2166136261;
  for (const char of texto) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

function uuidFalso(base: string): string {
  const hex = (n: number, tamanho: number) =>
    (semente(base + n).toString(16) + "0".repeat(tamanho)).slice(0, tamanho);
  return `${hex(1, 8)}-${hex(2, 4)}-4${hex(3, 3)}-a${hex(4, 3)}-${hex(5, 12)}`;
}

const DOCUMENTO = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/;

describe.skipIf(!existsSync(origem))("geracao da fixture OFX anonimizada", () => {
  it("gera tests/fixtures/extrato-cora.ofx sem nenhum dado real", () => {
    const original = readFileSync(origem, "utf8");

    // Valores fabricados, na ordem em que as transacoes aparecem.
    const valoresOriginais = [...original.matchAll(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g)];
    const novosValores = valoresOriginais.map(([, valor]) => {
      const negativo = valor!.startsWith("-");
      const bruto = 10000 + (semente(valor! + valoresOriginais.length) % 900000);
      return (negativo ? -bruto : bruto) / 100;
    });

    let indiceValor = 0;
    let saida = original;

    saida = saida
      .replace(/<ACCTID>[^<]+<\/ACCTID>/g, "<ACCTID>12345678</ACCTID>")
      .replace(/<FITID>([^<]+)<\/FITID>/g, (_todo, id: string) => `<FITID>${uuidFalso(id)}</FITID>`)
      .replace(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g, () => {
        const novo = novosValores[indiceValor++]!;
        return `<TRNAMT>${novo.toFixed(2)}</TRNAMT>`;
      })
      .replace(/<MEMO>([^<]*)<\/MEMO>/g, (_todo, memo: string) => {
        // O memo do Cora e "tipo - nome - documento". So o tipo e preservado.
        const partes = memo.split(" - ");
        const tipo = partes[0]!;
        const documentoOriginal = DOCUMENTO.exec(memo)?.[0];
        const lista = documentoOriginal?.includes("/") ? CNPJS : CPFS;
        const documento = lista[semente(memo) % lista.length]!;
        const nome = NOMES[semente(memo + "n") % NOMES.length]!;
        return `<MEMO>${tipo} - ${nome} - ${documento}</MEMO>`;
      });

    // Saldo final recalculado a partir de um saldo inicial fabricado, para que a
    // conferencia de integridade tenha o que verificar.
    const SALDO_INICIAL = 2780.45;
    const movimento = novosValores.reduce((total, valor) => total + valor, 0);
    const saldoFinal = Math.round((SALDO_INICIAL + movimento) * 100) / 100;
    saida = saida.replace(/<BALAMT>[^<]+<\/BALAMT>/, `<BALAMT>${saldoFinal.toFixed(2)}</BALAMT>`);

    // --- conferencia de vazamento, derivada do proprio arquivo ---
    const sensiveis = new Set<string>();
    for (const [, documento] of original.matchAll(
      /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/g,
    )) {
      sensiveis.add(documento!);
    }
    for (const [, id] of original.matchAll(/<FITID>([^<]+)<\/FITID>/g)) sensiveis.add(id!);
    for (const [, valor] of original.matchAll(/<TRNAMT>(-?[\d.]+)<\/TRNAMT>/g)) sensiveis.add(valor!);
    for (const [, valor] of original.matchAll(/<BALAMT>([^<]+)<\/BALAMT>/g)) sensiveis.add(valor!);
    for (const [, conta] of original.matchAll(/<ACCTID>([^<]+)<\/ACCTID>/g)) sensiveis.add(conta!);
    for (const [, memo] of original.matchAll(/<MEMO>([^<]*)<\/MEMO>/g)) {
      const nome = memo!.split(" - ")[1];
      if (nome) sensiveis.add(nome.trim());
    }

    expect(sensiveis.size).toBeGreaterThan(80);

    for (const sensivel of sensiveis) {
      if (sensivel.length < 5) continue;
      expect(saida, `vazou "${sensivel}" para a fixture`).not.toContain(sensivel);
    }

    writeFileSync(destino, saida);
    console.log(
      `\n  fixture OFX gerada: ${novosValores.length} transacoes, ${sensiveis.size} valores sensiveis conferidos`,
    );
  });
});

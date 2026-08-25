/**
 * Leitor do extrato em PDF do Cora.
 *
 * Roda sobre uma fixture ANONIMIZADA gerada a partir de um extrato de verdade
 * (tests/local/gerar-fixture.test.ts): a geometria e a mesma — coordenadas,
 * recuos, quebra de colunas, nomes truncados, ordem invertida, quatro paginas —
 * mas nomes, documentos e valores sao fabricados. Extrato real carrega a
 * carteira de clientes da assessoria e nao entra em repositorio.
 *
 * O leitor de layout e uma funcao pura sobre linhas, entao estes testes nao
 * precisam de PDF binario nenhum.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCoraLinhas } from "@/lib/import/cora";
import type { LinhaPdf } from "@/lib/import/pdf";
import { ImportError } from "@/lib/import/types";
import { fromDb, toDb } from "@/lib/domain/money";
import { normalizeText } from "@/lib/domain/matching";
import { categorize } from "@/lib/domain/rules";

const linhas = JSON.parse(
  readFileSync(fileURLToPath(new URL("../fixtures/extrato-cora-linhas.json", import.meta.url)), "utf8"),
) as LinhaPdf[];

const extrato = parseCoraLinhas(linhas);

describe("leitura do extrato", () => {
  it("le todas as transacoes das quatro paginas", () => {
    expect(extrato.lines).toHaveLength(43);
    expect(extrato.source).toBe("pdf");
  });

  it("descarta o cabecalho e o rodape que se repetem em cada pagina", () => {
    // "pág 1 de 4", "Ouvidoria:", "Extrato gerado no dia" aparecem 4 vezes cada.
    // Uma delas virar lancamento seria um movimento inventado no extrato.
    const memos = extrato.lines.map((linha) => linha.memo).join(" ");
    expect(memos).not.toMatch(/pág|Ouvidoria|Extrato gerado/i);
  });

  it("nao confunde a linha de saldo do dia com uma transacao", () => {
    // "25/08/2026 Saldo do dia R$ 164.234,20" tem data e valor, igual a uma
    // transacao. O que as separa e o recuo: transacao vem indentada.
    expect(extrato.lines.every((linha) => !/Saldo do dia/i.test(linha.memo))).toBe(true);
  });

  it("entrega em ordem cronologica, embora o extrato liste do mais novo", () => {
    const datas = extrato.lines.map((linha) => linha.postedAt);
    expect(datas).toEqual([...datas].sort());
    expect(datas[0]).toBe("2026-08-01");
  });

  it("aplica o sinal a partir do prefixo do valor", () => {
    const entradas = extrato.lines.filter((linha) => linha.amount > 0);
    const saidas = extrato.lines.filter((linha) => linha.amount < 0);
    expect(entradas.length).toBeGreaterThan(0);
    expect(saidas.length).toBeGreaterThan(0);
  });
});

describe("conferencia contra o que o extrato declara", () => {
  const integridade = extrato.integrity!;

  it("bate os totais de entradas e saidas", () => {
    expect(integridade.computedInflow).toBe(integridade.declaredInflow);
    expect(integridade.computedOutflow).toBe(integridade.declaredOutflow);
  });

  it("bate o saldo final", () => {
    expect(integridade.computedClosing).toBe(integridade.declaredClosing);
  });

  it("bate o saldo de todos os dias, um a um", () => {
    // A conferencia mais forte que este formato permite: o extrato imprime o
    // saldo de cada dia, entao da para localizar EM QUE DIA a leitura divergiu,
    // em vez de so saber que o total ficou errado.
    expect(integridade.dailyChecks).toHaveLength(15);
    expect(integridade.dailyChecks.every((check) => check.ok)).toBe(true);
  });

  it("conclui que o extrato esta integro", () => {
    expect(integridade.problems).toEqual([]);
    expect(integridade.ok).toBe(true);
  });
});

describe("contraparte", () => {
  it("guarda o CNPJ inteiro mesmo quando o nome vem cortado", () => {
    // A razao de existir do campo: 27 dos 43 nomes chegam truncados, mas o
    // documento vem completo. Ele e a chave estavel para casar a contraparte.
    const truncadas = extrato.lines.filter((linha) => linha.nameTruncated);
    expect(truncadas.length).toBeGreaterThan(20);
    expect(truncadas.every((linha) => /^\d{11}$|^\d{14}$/.test(linha.counterpartyDocument ?? ""))).toBe(true);
  });

  it("tira as reticencias do nome, mas registra que ele foi cortado", () => {
    const truncada = extrato.lines.find((linha) => linha.nameTruncated)!;
    expect(truncada.counterpartyName).not.toMatch(/…/);
    expect(truncada.nameTruncated).toBe(true);
  });

  it("distingue CPF de CNPJ", () => {
    const documentos = extrato.lines.map((linha) => linha.counterpartyDocument);
    expect(documentos.some((doc) => doc?.length === 14)).toBe(true);
    expect(documentos.some((doc) => doc?.length === 11)).toBe(true);
  });

  it("avisa sobre os nomes cortados e aponta o caminho melhor", () => {
    expect(extrato.warnings.join(" ")).toMatch(/nome cortado/);
    expect(extrato.warnings.join(" ")).toMatch(/CNPJ\/CPF veio inteiro/);
  });

  it("leva tipo, nome e documento para o memo, que e o que as regras percorrem", () => {
    const linha = extrato.lines.find((l) => l.counterpartyDocument !== undefined)!;
    expect(linha.memo).toMatch(/Pagamento recebido|Boleto pago|Pix/i);
    expect(linha.memo).toContain(linha.counterpartyName!);
  });
});

describe("periodo que o extrato de fato atesta", () => {
  it("termina no ultimo dia com saldo, e nao no fim declarado", () => {
    // O extrato diz cobrir 01/08 a 31/08, mas foi gerado no dia 25. Gravar
    // 31/08 faria o sistema tratar agosto como coberto, e os dias 26 a 31 nunca
    // seriam cobrados de ninguem.
    expect(extrato.periodStart).toBe("2026-08-01");
    expect(extrato.periodEnd).toBe("2026-08-25");
  });

  it("avisa que o mes esta incompleto", () => {
    expect(extrato.warnings.join(" ")).toMatch(/diz cobrir ate 31\/08\/2026/);
    expect(extrato.warnings.join(" ")).toMatch(/peca o extrato do restante/);
  });
});

describe("deduplicacao", () => {
  it("gera uma chave distinta para cada linha", () => {
    const chaves = new Set(extrato.lines.map((linha) => linha.dedupKey));
    expect(chaves.size).toBe(extrato.lines.length);
  });

  it("produz as mesmas chaves ao reprocessar o mesmo arquivo", () => {
    // A propriedade que garante que reimportar o extrato nao duplica movimento.
    const denovo = parseCoraLinhas(linhas);
    expect(denovo.lines.map((l) => l.dedupKey)).toEqual(extrato.lines.map((l) => l.dedupKey));
  });

  it("nao usa FITID, porque PDF nao tem", () => {
    expect(extrato.lines.every((linha) => linha.fitid === undefined)).toBe(true);
    expect(extrato.lines.every((linha) => linha.dedupKey.startsWith("c:"))).toBe(true);
  });
});

describe("leitura errada e detectada, nao silenciada", () => {
  /** Remove uma transacao, simulando uma linha que o leitor deixou passar. */
  function semUmaTransacao(): LinhaPdf[] {
    const alvo = linhas.findIndex(
      (linha) => linha.recuo >= 45 && /[+-]\s*R\$/.test(linha.texto),
    );
    return linhas.filter((_, indice) => indice !== alvo);
  }

  it("acusa quando uma linha se perde", () => {
    // O pior modo de falha de um leitor de PDF nao e quebrar: e ler errado e
    // seguir em frente. O saldo sairia plausivel e a diferenca so apareceria no
    // fechamento, quando ninguem mais liga uma coisa a outra.
    const quebrado = parseCoraLinhas(semUmaTransacao());

    expect(quebrado.lines).toHaveLength(42);
    expect(quebrado.integrity!.ok).toBe(false);
    expect(quebrado.integrity!.problems.length).toBeGreaterThan(0);
    expect(quebrado.warnings.join(" ")).toMatch(/nao confere/);
  });

  it("diz em que dia a leitura divergiu", () => {
    const quebrado = parseCoraLinhas(semUmaTransacao());
    const primeiroErro = quebrado.integrity!.dailyChecks.find((check) => !check.ok);

    expect(primeiroErro).toBeDefined();
    expect(primeiroErro!.declared).not.toBe(primeiroErro!.computed);
    expect(quebrado.integrity!.problems.join(" ")).toContain(primeiroErro!.date);
  });

  it("acusa quando um valor e lido errado", () => {
    const adulterado = linhas.map((linha) =>
      linha.texto.includes("+ R$ 3.451,77")
        ? { ...linha, texto: linha.texto.replace("+ R$ 3.451,77", "+ R$ 3.451,78"),
            celulas: linha.celulas.map((c) => ({ ...c, texto: c.texto.replace("+ R$ 3.451,77", "+ R$ 3.451,78") })) }
        : linha,
    );

    const resultado = parseCoraLinhas(adulterado);
    expect(resultado.integrity!.ok).toBe(false);
    // Um centavo basta para a conferencia acusar.
    expect(resultado.integrity!.problems.join(" ")).toMatch(/Total de entradas nao confere/);
  });
});

describe("arquivo que nao serve", () => {
  it("recusa PDF de outro banco, indicando o caminho que funciona", () => {
    const outro: LinhaPdf[] = [
      { pagina: 1, y: 700, recuo: 30, texto: "Banco Qualquer S.A.", celulas: [] },
    ];
    expect(() => parseCoraLinhas(outro)).toThrow(ImportError);
    expect(() => parseCoraLinhas(outro)).toThrow(/exporte em OFX/);
  });

  it("recusa extrato do Cora sem nenhuma transacao", () => {
    const vazio: LinhaPdf[] = [
      { pagina: 1, y: 700, recuo: 30, texto: "Cora SCFI - CNPJ 37.880.206/0001-63", celulas: [] },
    ];
    expect(() => parseCoraLinhas(vazio)).toThrow(/layout do extrato pode ter mudado/);
  });
});

describe("valores", () => {
  it("le o formato brasileiro com milhar", () => {
    const total = extrato.lines.reduce((soma, linha) => soma + linha.amount, 0);
    expect(toDb(total)).toBe(
      toDb(extrato.integrity!.computedInflow - extrato.integrity!.computedOutflow),
    );
  });

  it("guarda o saldo inicial declarado pelo extrato", () => {
    expect(extrato.openingBalance).toBe(fromDb("27800.45"));
  });
});

describe("o CNPJ salva a categorizacao que o nome truncado quebraria", () => {
  it("uma regra por documento casa mesmo com o nome cortado", () => {
    // O fecho do argumento: 27 dos 43 nomes chegam pela metade, entao regra por
    // nome seria fragil. O documento vem inteiro e vai para o memo, que e o que
    // as regras percorrem — a categorizacao continua funcionando.
    const comDocumento = extrato.lines.find(
      (linha) => linha.nameTruncated && linha.counterpartyDocument !== undefined,
    )!;

    const cnpjFormatado = comDocumento.memo.match(
      /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2}/,
    )![0];

    const classificacao = categorize(
      { memo: comDocumento.memo, amount: comDocumento.amount, bankAccountId: "cora" },
      [
        {
          id: "por-documento",
          matchText: cnpjFormatado,
          categoryId: "cat-vendas",
          counterpartyId: "cp-cliente",
          priority: 10,
          isActive: true,
        },
      ],
    );

    expect(classificacao.categoryId).toBe("cat-vendas");
    expect(classificacao.counterpartyId).toBe("cp-cliente");
  });

  it("a regra por documento sobrevive a mudanca de pontuacao", () => {
    // O extrato imprime "66.777.888/0001-36"; alguem pode cadastrar a regra
    // digitando so os digitos. A normalizacao tem de tratar os dois iguais.
    expect(normalizeText("66.777.888/0001-36")).toBe(normalizeText("66 777 888 0001 36"));
  });
});

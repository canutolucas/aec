/**
 * Teste de ponta a ponta do dominio: extrato importado, conciliado contra os
 * lancamentos e provado contra o saldo que o proprio banco declarou.
 *
 * E a afirmacao central da ferramenta — "o saldo do sistema bate com o do
 * banco" — verificada de fato, e nao so no discurso.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { currentBalance } from "@/lib/domain/balance";
import { divergences, type MatchableTransaction, matchStatement } from "@/lib/domain/matching";
import { fromDb, sum, toDb } from "@/lib/domain/money";
import { categorize, type CategorizationRule, suggestRuleText } from "@/lib/domain/rules";
import { parseOfx } from "@/lib/import/ofx";
import { toMatchableLines } from "@/lib/import";

const extrato = parseOfx(
  readFileSync(fileURLToPath(new URL("../fixtures/extrato-ofx1-sgml.ofx", import.meta.url)), "utf8"),
);

const CONTA = {
  bankAccountId: "itau",
  openingBalance: fromDb("10000.00"),
  openingBalanceDate: "2025-03-01",
};

function lancamento(
  id: string,
  bookingDate: string,
  amount: string,
  description: string,
): MatchableTransaction {
  return { id, bookingDate, amount: fromDb(amount), description };
}

describe("mes que fecha", () => {
  // O que a assessoria lancou durante o mes, do jeito que ela descreve.
  const lancados = [
    lancamento("t1", "2025-03-05", "2500.00", "Honorarios cliente Alfa"),
    lancamento("t2", "2025-03-10", "-1800.00", "Aluguel marco"),
    lancamento("t3", "2025-03-31", "-99.90", "Tarifa bancaria"),
  ];

  const resultado = matchStatement(toMatchableLines(extrato), lancados);

  it("concilia tudo, sem sobra dos dois lados", () => {
    expect(resultado.matched).toHaveLength(3);
    expect(resultado.unmatchedLines).toHaveLength(0);
    expect(resultado.unmatchedTransactions).toHaveLength(0);
    expect(divergences(resultado)).toEqual([]);
  });

  it("casa apesar de a descricao lancada nao parecer com o memo do banco", () => {
    // "Aluguel marco" contra "PAGAMENTO BOLETO - IMOBILIARIA CENTRAL - ALUGUEL
    // MARCO": o que sustenta o casamento e valor e data, nao o texto.
    const aluguel = resultado.matched.find((m) => m.transactionId === "t2");
    expect(aluguel).toBeDefined();
    expect(aluguel!.dayGap).toBe(0);
  });

  it("o saldo do sistema bate com o saldo que o banco declarou", () => {
    // A prova que a planilha nunca deu: nao e "confere pelas linhas", e "o total
    // e exatamente este".
    const saldo = currentBalance(
      CONTA,
      lancados.map((t) => ({
        bookingDate: t.bookingDate,
        amount: t.amount,
        status: "realizado" as const,
      })),
    );

    expect(toDb(saldo)).toBe(toDb(extrato.ledgerBalance!));
    expect(toDb(saldo)).toBe("10600.10");
  });
});

describe("mes que nao fecha", () => {
  // Faltou lancar a tarifa, e ha um pagamento lancado que o banco nao registrou.
  const lancados = [
    lancamento("t1", "2025-03-05", "2500.00", "Honorarios cliente Alfa"),
    lancamento("t2", "2025-03-10", "-1800.00", "Aluguel marco"),
    lancamento("t9", "2025-03-28", "-500.00", "Pagamento que nao saiu"),
  ];

  const resultado = matchStatement(toMatchableLines(extrato), lancados);
  const lista = divergences(resultado);

  it("aponta as duas divergencias, cada uma com seu tipo", () => {
    expect(lista).toHaveLength(2);
    expect(lista.map((d) => d.kind)).toEqual(["faltando_no_extrato", "faltando_no_sistema"]);
  });

  it("diz o que falta lancar", () => {
    const faltaLancar = lista.find((d) => d.kind === "faltando_no_sistema")!;
    expect(faltaLancar.description).toContain("TARIFA");
    expect(toDb(faltaLancar.amount)).toBe("-99.90");
  });

  it("diz o que foi lancado mas o banco nao registrou", () => {
    const naoSaiu = lista.find((d) => d.kind === "faltando_no_extrato")!;
    expect(naoSaiu.description).toBe("Pagamento que nao saiu");
    expect(toDb(naoSaiu.amount)).toBe("-500.00");
  });

  it("as divergencias explicam exatamente a diferenca entre os dois saldos", () => {
    // Isto e o que transforma "nao bateu" em "nao bateu por causa destes dois
    // lancamentos" — a diferenca entre uma tarde de conferencia e dois minutos.
    const saldoSistema = currentBalance(
      CONTA,
      lancados.map((t) => ({
        bookingDate: t.bookingDate,
        amount: t.amount,
        status: "realizado" as const,
      })),
    );

    const diferenca = extrato.ledgerBalance! - saldoSistema;
    const explicacao = sum(
      lista.map((d) => (d.kind === "faltando_no_sistema" ? d.amount : -d.amount)),
    );

    expect(toDb(explicacao)).toBe(toDb(diferenca));
    expect(toDb(diferenca)).toBe("400.10");
  });
});

describe("a conciliacao alimenta a categorizacao do mes seguinte", () => {
  it("a regra proposta a partir do memo categoriza a importacao seguinte", () => {
    // O ciclo que faz a conciliacao ficar mais barata a cada mes: quem opera
    // categoriza uma vez, o sistema guarda a regra, e no mes seguinte a linha
    // ja chega classificada.
    const aluguelDeMarco = extrato.lines.find((l) => l.memo.includes("IMOBILIARIA"))!;

    const textoDaRegra = suggestRuleText(aluguelDeMarco.memo);
    // Note o que ficou de fora: "pagamento" e "boleto" sao jargao, e "marco" e o
    // mes — uma regra que contivesse o mes pararia de casar em abril.
    expect(textoDaRegra).toBe("imobiliaria central aluguel");

    const regras: CategorizationRule[] = [
      {
        id: "r-aluguel",
        matchText: textoDaRegra,
        categoryId: "cat-aluguel",
        counterpartyId: "cp-imobiliaria",
        priority: 100,
        isActive: true,
      },
    ];

    // Abril chega com o memo do banco ligeiramente diferente, como sempre chega.
    const aluguelDeAbril = {
      memo: "PAGAMENTO BOLETO - IMOBILIARIA CENTRAL - ALUGUEL ABRIL",
      amount: fromDb("-1800.00"),
      bankAccountId: "itau",
    };

    const classificacao = categorize(aluguelDeAbril, regras);
    expect(classificacao.categoryId).toBe("cat-aluguel");
    expect(classificacao.counterpartyId).toBe("cp-imobiliaria");
  });
});

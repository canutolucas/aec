import { describe, expect, it } from "vitest";
import {
  divergences,
  type MatchableTransaction,
  matchStatement,
  normalizeText,
  type StatementLine,
  textSimilarity,
} from "@/lib/domain/matching";
import { fromDb, toDb } from "@/lib/domain/money";

function linha(id: string, postedAt: string, amount: string, memo: string): StatementLine {
  return { id, postedAt, amount: fromDb(amount), memo };
}

function lancamento(
  id: string,
  bookingDate: string,
  amount: string,
  description: string,
  documentNumber?: string,
): MatchableTransaction {
  return { id, bookingDate, amount: fromDb(amount), description, documentNumber };
}

describe("normalizacao de texto", () => {
  it("remove acento, pontuacao e caixa", () => {
    expect(normalizeText("TED REC. JOÃO SILVA")).toBe("ted rec joao silva");
    expect(normalizeText("Pagamento  ALUGUEL/MARÇO")).toBe("pagamento aluguel marco");
  });

  it("trata string vazia", () => {
    expect(normalizeText("")).toBe("");
    expect(normalizeText("   ")).toBe("");
  });
});

describe("semelhanca entre textos", () => {
  it("da 1 para textos iguais depois de normalizados", () => {
    expect(textSimilarity("ALUGUEL MARCO", "aluguel março")).toBe(1);
  });

  it("da 0 para textos sem palavra em comum", () => {
    expect(textSimilarity("aluguel", "energia eletrica")).toBe(0);
  });

  it("da valor intermediario para sobreposicao parcial", () => {
    const similaridade = textSimilarity("pagamento aluguel marco", "aluguel marco");
    expect(similaridade).toBeGreaterThan(0);
    expect(similaridade).toBeLessThan(1);
  });

  it("ignora palavra de uma letra, que casaria qualquer coisa", () => {
    expect(textSimilarity("a b c", "x y z")).toBe(0);
  });
});

describe("casamento automatico", () => {
  it("casa valor identico na mesma data", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-05", "2500.00", "TED RECEBIDA CLIENTE")],
      [lancamento("t1", "2025-03-05", "2500.00", "Honorarios marco")],
    );

    expect(resultado.matched).toHaveLength(1);
    expect(resultado.matched[0]).toMatchObject({ lineId: "l1", transactionId: "t1", dayGap: 0 });
    expect(resultado.unmatchedLines).toHaveLength(0);
    expect(resultado.unmatchedTransactions).toHaveLength(0);
  });

  it("casa dentro da tolerancia de tres dias", () => {
    // O caso real: pagamento feito na sexta, compensado na segunda.
    const resultado = matchStatement(
      [linha("l1", "2025-03-10", "-1800.00", "PAGTO BOLETO")],
      [lancamento("t1", "2025-03-07", "-1800.00", "Aluguel marco")],
    );

    expect(resultado.matched).toHaveLength(1);
    expect(resultado.matched[0]!.dayGap).toBe(3);
  });

  it("nunca casa valores diferentes, por mais parecido que seja o resto", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-05", "2500.00", "Aluguel marco")],
      [lancamento("t1", "2025-03-05", "2500.01", "Aluguel marco")],
    );

    expect(resultado.matched).toHaveLength(0);
    expect(resultado.suggested).toHaveLength(0);
    expect(resultado.unmatchedLines).toHaveLength(1);
    expect(resultado.unmatchedTransactions).toHaveLength(1);
  });

  it("nao confunde entrada com saida de mesmo modulo", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-05", "500.00", "recebimento")],
      [lancamento("t1", "2025-03-05", "-500.00", "pagamento")],
    );

    expect(resultado.matched).toHaveLength(0);
  });
});

describe("sugestao quando a data esta distante", () => {
  it("sugere em vez de casar sozinho", () => {
    // Casar isto automaticamente esconderia um erro que so apareceria no
    // fechamento, quando ja nao da para saber qual casamento foi o errado.
    const resultado = matchStatement(
      [linha("l1", "2025-03-25", "1000.00", "TED RECEBIDA")],
      [lancamento("t1", "2025-03-05", "1000.00", "Recebimento cliente")],
    );

    expect(resultado.matched).toHaveLength(0);
    expect(resultado.suggested).toHaveLength(1);
    expect(resultado.suggested[0]!.dayGap).toBe(20);
    expect(resultado.suggested[0]!.reason).toContain("confirme antes de aceitar");
  });

  it("nem sugere alem da janela maxima", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-06-05", "1000.00", "TED")],
      [lancamento("t1", "2025-03-05", "1000.00", "Recebimento")],
    );

    expect(resultado.matched).toHaveLength(0);
    expect(resultado.suggested).toHaveLength(0);
    expect(resultado.unmatchedLines).toHaveLength(1);
  });
});

describe("dois pagamentos de mesmo valor no mesmo mes", () => {
  it("casa cada um com o mais proximo, e nao trocados", () => {
    // O erro classico da conciliacao ingenua, que casa na ordem em que encontra.
    const resultado = matchStatement(
      [
        linha("l-dia-5", "2025-03-05", "-1000.00", "PAGTO FORNECEDOR"),
        linha("l-dia-20", "2025-03-20", "-1000.00", "PAGTO FORNECEDOR"),
      ],
      [
        lancamento("t-dia-20", "2025-03-20", "-1000.00", "Fornecedor parcela 2"),
        lancamento("t-dia-5", "2025-03-05", "-1000.00", "Fornecedor parcela 1"),
      ],
    );

    expect(resultado.matched).toHaveLength(2);
    const pares = Object.fromEntries(
      resultado.matched.map((m) => [m.lineId, m.transactionId]),
    );
    expect(pares).toEqual({ "l-dia-5": "t-dia-5", "l-dia-20": "t-dia-20" });
  });

  it("nao reutiliza o mesmo lancamento em duas linhas", () => {
    const resultado = matchStatement(
      [
        linha("l1", "2025-03-05", "-1000.00", "PAGTO"),
        linha("l2", "2025-03-05", "-1000.00", "PAGTO"),
      ],
      [lancamento("t1", "2025-03-05", "-1000.00", "Fornecedor")],
    );

    expect(resultado.matched).toHaveLength(1);
    expect(resultado.unmatchedLines).toHaveLength(1);
    expect(resultado.unmatchedTransactions).toHaveLength(0);
  });
});

describe("numero do documento no memo", () => {
  it("faz o par com o documento vencer o par so por data", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-10", "-1500.00", "PAGTO BOLETO 998877")],
      [
        lancamento("t-sem-doc", "2025-03-10", "-1500.00", "Fornecedor A"),
        lancamento("t-com-doc", "2025-03-12", "-1500.00", "Fornecedor B", "998877"),
      ],
    );

    expect(resultado.matched[0]!.transactionId).toBe("t-com-doc");
    expect(resultado.matched[0]!.reason).toContain("numero do documento");
  });
});

describe("divergencias", () => {
  it("separa o que falta lancar do que pode nao ter acontecido", () => {
    const resultado = matchStatement(
      [
        linha("l1", "2025-03-05", "2500.00", "TED RECEBIDA"),
        linha("l2", "2025-03-08", "-99.90", "TARIFA MENSAL"),
      ],
      [
        lancamento("t1", "2025-03-05", "2500.00", "Honorarios"),
        lancamento("t2", "2025-03-09", "-450.00", "Pagamento que nao saiu"),
      ],
    );

    const lista = divergences(resultado);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ kind: "faltando_no_sistema", description: "TARIFA MENSAL" });
    expect(lista[1]).toMatchObject({ kind: "faltando_no_extrato" });
  });

  it("a soma das divergencias explica a diferenca entre os dois saldos", () => {
    // A propriedade que transforma "nao bateu" em "nao bateu por causa destes".
    const linhas = [
      linha("l1", "2025-03-05", "2500.00", "TED"),
      linha("l2", "2025-03-08", "-99.90", "TARIFA"),
    ];
    const lancamentos = [
      lancamento("t1", "2025-03-05", "2500.00", "Honorarios"),
      lancamento("t2", "2025-03-09", "-450.00", "Pagamento pendente"),
    ];

    const saldoExtrato = linhas.reduce((total, l) => total + l.amount, 0);
    const saldoSistema = lancamentos.reduce((total, t) => total + t.amount, 0);

    const ajuste = divergences(matchStatement(linhas, lancamentos)).reduce(
      (total, d) => total + (d.kind === "faltando_no_sistema" ? d.amount : -d.amount),
      0,
    );

    expect(toDb(saldoSistema + ajuste)).toBe(toDb(saldoExtrato));
  });

  it("devolve lista vazia quando tudo concilia", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-05", "100.00", "x")],
      [lancamento("t1", "2025-03-05", "100.00", "x")],
    );
    expect(divergences(resultado)).toEqual([]);
  });
});

describe("casos de borda", () => {
  it("lida com extrato vazio", () => {
    const resultado = matchStatement([], [lancamento("t1", "2025-03-05", "100.00", "x")]);
    expect(resultado.matched).toHaveLength(0);
    expect(resultado.unmatchedTransactions).toHaveLength(1);
  });

  it("lida com sistema vazio", () => {
    const resultado = matchStatement([linha("l1", "2025-03-05", "100.00", "x")], []);
    expect(resultado.unmatchedLines).toHaveLength(1);
  });

  it("aceita tolerancia customizada", () => {
    const resultado = matchStatement(
      [linha("l1", "2025-03-15", "100.00", "x")],
      [lancamento("t1", "2025-03-05", "100.00", "x")],
      { exactDayTolerance: 10 },
    );
    expect(resultado.matched).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";

import { fromDb } from "../src/money";
import {
  type CreditTransaction,
  extractTaxIdFromText,
  matchReceivables,
  type OpenInvoice,
} from "../src/receivables";

function invoice(overrides: Partial<OpenInvoice> & { id: string; number: string }): OpenInvoice {
  return {
    issuedOn: "2025-04-01",
    amount: fromDb("1000.00"),
    outstanding: fromDb("1000.00"),
    clientName: "Cliente Padrao",
    ...overrides,
  };
}

function credit(overrides: Partial<CreditTransaction> & { id: string }): CreditTransaction {
  return {
    bookingDate: "2025-05-01",
    amount: fromDb("1000.00"),
    ...overrides,
  };
}

const CNPJ_XYZ = "22333444000155";
const CNPJ_ABC = "55666777000188";

describe("matchReceivables — exato", () => {
  it("casa um credito com CNPJ e valor exatamente igual ao saldo em aberto — auto-aplica", () => {
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_XYZ, amount: fromDb("1000.00") })],
      [invoice({ id: "i1", number: "NF-1", clientTaxId: CNPJ_XYZ })],
    );

    expect(result.matched).toEqual([
      {
        transactionId: "t1",
        invoiceIds: ["i1"],
        confidence: "exact",
        reason: expect.stringContaining("NF-1"),
      },
    ]);
    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([]);
  });
});

describe("matchReceivables — retencao de imposto", () => {
  it("credito abaixo do saldo, mas dentro do piso de retencao, vira sugestao (nunca automatico)", () => {
    // Nota de 1000, credito de 935 (6,5% de retencao) — dentro do piso default (80%).
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_ABC, amount: fromDb("935.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-2",
          clientTaxId: CNPJ_ABC,
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0]).toMatchObject({
      transactionId: "t1",
      invoiceIds: ["i1"],
      confidence: "likely",
    });
  });

  it("credito muito abaixo do piso de retencao nao vira sugestao nenhuma", () => {
    // 50% do valor da nota — bem alem de qualquer retencao plausivel.
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_ABC, amount: fromDb("500.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-3",
          clientTaxId: CNPJ_ABC,
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toEqual([
      credit({ id: "t1", counterpartyTaxId: CNPJ_ABC, amount: fromDb("500.00") }),
    ]);
  });
});

describe("matchReceivables — PIX agrupado", () => {
  it("um credito que fecha a soma de duas notas do mesmo cliente vira sugestao com as duas notas", () => {
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_XYZ, amount: fromDb("1500.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-1",
          clientTaxId: CNPJ_XYZ,
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
        invoice({
          id: "i2",
          number: "NF-2",
          clientTaxId: CNPJ_XYZ,
          amount: fromDb("500.00"),
          outstanding: fromDb("500.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toHaveLength(1);
    expect([...result.suggested[0]!.invoiceIds].sort()).toEqual(["i1", "i2"]);
    expect(result.suggested[0]!.confidence).toBe("likely");
  });

  it("nao confunde duas notas de mesmo valor do mesmo cliente — cada uma casa uma vez so", () => {
    const result = matchReceivables(
      [
        credit({ id: "t1", counterpartyTaxId: CNPJ_XYZ, amount: fromDb("500.00") }),
        credit({ id: "t2", counterpartyTaxId: CNPJ_XYZ, amount: fromDb("500.00") }),
      ],
      [
        invoice({
          id: "i1",
          number: "NF-1",
          clientTaxId: CNPJ_XYZ,
          amount: fromDb("500.00"),
          outstanding: fromDb("500.00"),
        }),
        invoice({
          id: "i2",
          number: "NF-2",
          clientTaxId: CNPJ_XYZ,
          amount: fromDb("500.00"),
          outstanding: fromDb("500.00"),
        }),
      ],
    );

    expect(result.matched).toHaveLength(2);
    const matchedInvoiceIds = result.matched.flatMap((m) => m.invoiceIds).sort();
    expect(matchedInvoiceIds).toEqual(["i1", "i2"]);
  });

  it("cliente com muitas notas em aberto ao mesmo tempo fica sem sugestao de agrupamento, sem travar", () => {
    // Regressao: a busca por subconjuntos que somam o valor do credito e
    // 2^n por forca bruta (comentario original: "o numero de notas em aberto
    // do mesmo cliente ao mesmo tempo e pequeno na pratica"). Um cliente
    // real pode acumular dezenas de notas — acima do teto de seguranca, a
    // funcao tem que desistir da sugestao de agrupamento (cair para
    // unmatchedTransactions) em vez de rodar a busca inteira.
    const manyInvoices = Array.from({ length: 25 }, (_, i) =>
      invoice({
        id: `many-${i}`,
        number: `NF-${i}`,
        clientTaxId: CNPJ_XYZ,
        amount: fromDb("100.00"),
        outstanding: fromDb("100.00"),
      }),
    );

    // 200,00 fecha a soma exata de quaisquer duas notas de 100,00 — se a
    // busca rodasse sem o teto, ela encontraria esse par e sugeriria o
    // agrupamento.
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_XYZ, amount: fromDb("200.00") })],
      manyInvoices,
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("matchReceivables — parcial", () => {
  it("um credito por uma fracao do saldo, sem bater nenhuma regra de retencao/agrupamento, fica sem sugestao", () => {
    // 300 de uma nota de 1000 (30%) -- nem exato, nem dentro do piso de
    // retencao, nem soma de outras notas. E o caso "parcelado" que exige
    // a pessoa escolher manualmente na tela (fora do escopo deste dominio
    // puro -- aqui so cobre o que da para decidir com seguranca).
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: CNPJ_ABC, amount: fromDb("300.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-4",
          clientTaxId: CNPJ_ABC,
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });
});

describe("matchReceivables — sem CNPJ no extrato", () => {
  it("cai para valor exato + janela de data, sempre likely", () => {
    const result = matchReceivables(
      [credit({ id: "t1", bookingDate: "2025-04-20", amount: fromDb("1000.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-5",
          issuedOn: "2025-04-01",
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toHaveLength(1);
    expect(result.suggested[0]).toMatchObject({
      transactionId: "t1",
      invoiceIds: ["i1"],
      confidence: "likely",
    });
  });

  it("fora da janela de 90 dias, nao sugere", () => {
    const result = matchReceivables(
      [credit({ id: "t1", bookingDate: "2025-08-01", amount: fromDb("1000.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-5",
          issuedOn: "2025-04-01",
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });

  it("mais de uma nota com o mesmo valor na janela — ambiguo, nao arrisca", () => {
    const result = matchReceivables(
      [credit({ id: "t1", bookingDate: "2025-04-20", amount: fromDb("1000.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-5",
          issuedOn: "2025-04-01",
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
        invoice({
          id: "i2",
          number: "NF-6",
          issuedOn: "2025-04-05",
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });
});

describe("matchReceivables — nao inventa nota para CNPJ que nao bate", () => {
  it("CNPJ do credito nao corresponde a nenhuma nota — sem fallback por valor", () => {
    const result = matchReceivables(
      [credit({ id: "t1", counterpartyTaxId: "99999999000199", amount: fromDb("1000.00") })],
      [
        invoice({
          id: "i1",
          number: "NF-1",
          clientTaxId: CNPJ_XYZ,
          amount: fromDb("1000.00"),
          outstanding: fromDb("1000.00"),
        }),
      ],
    );

    expect(result.matched).toEqual([]);
    expect(result.suggested).toEqual([]);
    expect(result.unmatchedTransactions).toHaveLength(1);
  });
});

describe("extractTaxIdFromText", () => {
  it("acha um CNPJ pontuado em texto livre", () => {
    expect(extractTaxIdFromText("PIX RECEBIDO 22.333.444/0001-55 CLIENTE XYZ")).toBe(
      "22333444000155",
    );
  });

  it("acha um CPF pontuado em texto livre", () => {
    expect(extractTaxIdFromText("TED JOAO SILVA 123.456.789-01")).toBe("12345678901");
  });

  it("nao acha nada quando o texto nao tem documento pontuado", () => {
    expect(extractTaxIdFromText("PIX RECEBIDO CLIENTE SEM DOCUMENTO")).toBeUndefined();
  });
});

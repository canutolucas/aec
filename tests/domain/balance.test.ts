import { describe, expect, it } from "vitest";
import {
  type AccountOpening,
  type BalanceEntry,
  balanceOn,
  consolidate,
  currentBalance,
  dailyBalances,
} from "@/lib/domain/balance";
import { fromDb, toDb } from "@/lib/domain/money";

const conta: AccountOpening = {
  openingBalance: fromDb("10000.00"),
  openingBalanceDate: "2025-01-01",
};

function entry(
  bookingDate: string,
  amount: string,
  status: "realizado" | "previsto" = "realizado",
): BalanceEntry {
  return { bookingDate, amount: fromDb(amount), status };
}

describe("saldo em uma data", () => {
  const movimento = [
    entry("2025-03-05", "2500.00"),
    entry("2025-03-10", "-1800.00"),
    entry("2025-04-02", "-700.00"),
  ];

  it("parte do saldo inicial e soma o movimento ate a data", () => {
    expect(toDb(balanceOn(conta, movimento, "2025-03-04"))).toBe("10000.00");
    expect(toDb(balanceOn(conta, movimento, "2025-03-05"))).toBe("12500.00");
    expect(toDb(balanceOn(conta, movimento, "2025-03-31"))).toBe("10700.00");
    expect(toDb(balanceOn(conta, movimento, "2025-04-30"))).toBe("10000.00");
  });

  it("inclui o proprio dia da consulta", () => {
    expect(toDb(balanceOn(conta, movimento, "2025-03-10"))).toBe("10700.00");
  });

  it("devolve zero antes da data do saldo inicial", () => {
    expect(balanceOn(conta, movimento, "2024-12-31")).toBe(0);
  });
});

describe("ordem dos lancamentos nao afeta o saldo", () => {
  it("chega ao mesmo saldo com o movimento embaralhado", () => {
    // Importa quando o extrato chega fora de ordem, ou quando alguem lanca
    // retroativamente o que esqueceu.
    const emOrdem = [
      entry("2025-03-01", "100.00"),
      entry("2025-03-02", "-50.00"),
      entry("2025-03-03", "25.00"),
    ];
    const embaralhado = [emOrdem[2]!, emOrdem[0]!, emOrdem[1]!];

    expect(currentBalance(conta, embaralhado)).toBe(currentBalance(conta, emOrdem));
    expect(toDb(currentBalance(conta, embaralhado))).toBe("10075.00");
  });
});

describe("lancamento anterior ao saldo inicial", () => {
  it("e ignorado, porque o saldo inicial ja o contem", () => {
    // Soma-lo de novo contaria o mesmo dinheiro duas vezes. O banco recusa esses
    // lancamentos na entrada; o calculo tambem tem de estar certo diante de dado
    // historico importado.
    const comAnterior = [entry("2024-12-15", "5000.00"), entry("2025-03-05", "2500.00")];
    expect(toDb(currentBalance(conta, comAnterior))).toBe("12500.00");
  });
});

describe("previsto x realizado", () => {
  const movimento = [
    entry("2025-03-05", "2500.00"),
    entry("2025-03-20", "-1000.00", "previsto"),
  ];

  it("saldo realizado ignora o previsto", () => {
    expect(toDb(currentBalance(conta, movimento, "realizado"))).toBe("12500.00");
  });

  it("saldo total inclui o previsto", () => {
    expect(toDb(currentBalance(conta, movimento, "total"))).toBe("11500.00");
  });
});

describe("extrato dia a dia", () => {
  const movimento = [
    entry("2025-03-05", "2500.00"),
    entry("2025-03-05", "300.00"),
    entry("2025-03-07", "-1800.00"),
  ];

  it("devolve todos os dias do intervalo, mesmo os sem movimento", () => {
    const dias = dailyBalances(conta, movimento, "2025-03-04", "2025-03-08");
    expect(dias.map((d) => d.date)).toEqual([
      "2025-03-04",
      "2025-03-05",
      "2025-03-06",
      "2025-03-07",
      "2025-03-08",
    ]);
  });

  it("acumula o saldo corretamente", () => {
    const dias = dailyBalances(conta, movimento, "2025-03-04", "2025-03-08");
    expect(dias.map((d) => toDb(d.balance))).toEqual([
      "10000.00", // 04: sem movimento
      "12800.00", // 05: +2.500 +300
      "12800.00", // 06: sem movimento
      "11000.00", // 07: -1.800
      "11000.00", // 08: sem movimento
    ]);
  });

  it("separa entradas de saidas no mesmo dia", () => {
    const misto = [entry("2025-03-05", "2500.00"), entry("2025-03-05", "-400.00")];
    const dia = dailyBalances(conta, misto, "2025-03-05", "2025-03-05")[0]!;

    expect(toDb(dia.inflow)).toBe("2500.00");
    expect(toDb(dia.outflow)).toBe("-400.00");
    expect(toDb(dia.net)).toBe("2100.00");
    expect(dia.entryCount).toBe(2);
  });

  it("comeca do saldo acumulado, e nao do zero, quando a janela e posterior", () => {
    // A primeira linha do intervalo ja precisa refletir tudo que veio antes,
    // senao o grafico de evolucao comeca do lugar errado.
    const dias = dailyBalances(conta, movimento, "2025-03-10", "2025-03-11");
    expect(toDb(dias[0]!.balance)).toBe("11000.00");
  });

  it("atravessa a virada de mes sem escorregar a data", () => {
    const viraMes = [entry("2025-03-31", "1000.00"), entry("2025-04-01", "-500.00")];
    const dias = dailyBalances(conta, viraMes, "2025-03-30", "2025-04-02");

    expect(dias.map((d) => d.date)).toEqual([
      "2025-03-30",
      "2025-03-31",
      "2025-04-01",
      "2025-04-02",
    ]);
    expect(dias.map((d) => toDb(d.balance))).toEqual([
      "10000.00",
      "11000.00",
      "10500.00",
      "10500.00",
    ]);
  });
});

describe("saldo consolidado", () => {
  it("soma as contas da empresa", () => {
    const consolidado = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "2500.00"), entry("2025-03-10", "-1800.00")],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-06", "-200.00")],
      },
    ]);

    expect(toDb(consolidado.totalCurrent)).toBe("15500.00");
    expect(consolidado.perAccount.map((a) => toDb(a.current))).toEqual([
      "10700.00",
      "4800.00",
    ]);
  });

  it("separa realizado de projetado", () => {
    const consolidado = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("1000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "500.00"), entry("2025-03-20", "-300.00", "previsto")],
      },
    ]);

    expect(toDb(consolidado.totalCurrent)).toBe("1500.00");
    expect(toDb(consolidado.totalProjected)).toBe("1200.00");
  });

  it("devolve zero para empresa sem conta cadastrada", () => {
    const consolidado = consolidate([]);
    expect(consolidado.totalCurrent).toBe(0);
    expect(consolidado.perAccount).toEqual([]);
  });
});

describe("transferencia entre contas nao cria nem destroi dinheiro", () => {
  it("mantem o consolidado inalterado", () => {
    // A propriedade que a planilha quebra: mover 1.000 do Itau para o Bradesco
    // muda o saldo das duas contas, mas nao muda o total da empresa.
    const antes = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [],
      },
    ]);

    const depois = consolidate([
      {
        bankAccountId: "itau",
        openingBalance: fromDb("10000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "-1000.00")],
      },
      {
        bankAccountId: "bradesco",
        openingBalance: fromDb("5000.00"),
        openingBalanceDate: "2025-01-01",
        entries: [entry("2025-03-05", "1000.00")],
      },
    ]);

    expect(depois.totalCurrent).toBe(antes.totalCurrent);
    expect(toDb(depois.totalCurrent)).toBe("15000.00");
  });
});

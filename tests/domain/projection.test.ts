import { describe, expect, it } from "vitest";
import { BankingCalendar } from "@/lib/domain/dates";
import { fromDb, toDb } from "@/lib/domain/money";
import {
  expandRecurrence,
  project,
  type ProjectionEntry,
  projectHorizon,
} from "@/lib/domain/projection";

function previsto(bookingDate: string, amount: string, description = "previsto"): ProjectionEntry {
  return { bookingDate, amount: fromDb(amount), status: "previsto", description };
}

describe("projecao de caixa", () => {
  it("aplica os previstos dia a dia a partir do saldo de hoje", () => {
    const resultado = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-06",
      entries: [previsto("2025-03-04", "-3000.00"), previsto("2025-03-05", "1500.00")],
    });

    expect(resultado.days.map((d) => toDb(d.balance))).toEqual([
      "10000.00", // 03
      "7000.00", // 04
      "8500.00", // 05
      "8500.00", // 06
    ]);
    expect(toDb(resultado.finalBalance)).toBe("8500.00");
  });

  it("aponta a data exata em que o caixa fura", () => {
    // A resposta que a ferramenta existe para dar.
    const resultado = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [
        previsto("2025-03-05", "-2000.00", "Folha"),
        previsto("2025-03-07", "-4000.00", "Fornecedor"),
        previsto("2025-03-09", "3000.00", "Recebimento"),
      ],
    });

    expect(resultado.firstNegativeDate).toBe("2025-03-07");
    expect(toDb(resultado.lowestBalance)).toBe("-1000.00");
    expect(resultado.lowestBalanceDate).toBe("2025-03-07");
    expect(toDb(resultado.finalBalance)).toBe("2000.00");
  });

  it("nao aponta furo quando o caixa se mantem positivo", () => {
    const resultado = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [previsto("2025-03-05", "-2000.00")],
    });

    expect(resultado.firstNegativeDate).toBeNull();
    expect(toDb(resultado.lowestBalance)).toBe("8000.00");
  });

  it("alerta abaixo do saldo minimo antes de chegar a zero", () => {
    // Muita empresa precisa manter um colchao. O alerta util dispara antes do
    // saldo negativo, nao depois.
    const resultado = project({
      openingBalance: fromDb("10000.00"),
      from: "2025-03-03",
      to: "2025-03-10",
      entries: [previsto("2025-03-05", "-7000.00")],
      minimumBalance: fromDb("5000.00"),
    });

    expect(resultado.firstBelowMinimumDate).toBe("2025-03-05");
    expect(resultado.firstNegativeDate).toBeNull();
    expect(resultado.days.find((d) => d.date === "2025-03-05")?.belowMinimum).toBe(true);
    expect(resultado.days.find((d) => d.date === "2025-03-04")?.belowMinimum).toBe(false);
  });
});

describe("previsto vencido e nao pago", () => {
  it("e trazido para o primeiro dia, e nao sumido da projecao", () => {
    // Se o vencido desaparecesse, a projecao ficaria otimista — o pior defeito
    // possivel em uma ferramenta feita para antecipar aperto.
    const resultado = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-10",
      to: "2025-03-12",
      entries: [
        previsto("2025-03-01", "-2000.00", "Fornecedor vencido"),
        previsto("2025-02-20", "-1000.00", "Tributo vencido"),
        previsto("2025-03-11", "-500.00", "A vencer"),
      ],
    });

    expect(toDb(resultado.overdueBroughtForward)).toBe("-3000.00");
    expect(toDb(resultado.days[0]!.balance)).toBe("2000.00");
    expect(toDb(resultado.days[0]!.overdueBroughtForward)).toBe("-3000.00");
    expect(toDb(resultado.finalBalance)).toBe("1500.00");
  });

  it("nao repete o vencido nos dias seguintes", () => {
    const resultado = project({
      openingBalance: fromDb("5000.00"),
      from: "2025-03-10",
      to: "2025-03-12",
      entries: [previsto("2025-03-01", "-2000.00")],
    });

    expect(resultado.days.map((d) => toDb(d.overdueBroughtForward))).toEqual([
      "-2000.00",
      "0.00",
      "0.00",
    ]);
    expect(toDb(resultado.finalBalance)).toBe("3000.00");
  });

  it("conta o recebimento vencido tambem, nao so a despesa", () => {
    const resultado = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-10",
      to: "2025-03-10",
      entries: [previsto("2025-03-01", "2500.00", "Cliente em atraso")],
    });

    expect(toDb(resultado.days[0]!.balance)).toBe("3500.00");
  });
});

describe("dias uteis na projecao", () => {
  it("marca fim de semana e feriado", () => {
    const resultado = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-07", // sexta
      to: "2025-03-10", // segunda
      entries: [],
      calendar: new BankingCalendar(),
    });

    expect(resultado.days.map((d) => d.isBusinessDay)).toEqual([true, false, false, true]);
  });

  it("marca o Carnaval como dia nao util", () => {
    const resultado = project({
      openingBalance: fromDb("1000.00"),
      from: "2025-03-03", // Carnaval, segunda
      to: "2025-03-05", // quarta de cinzas
      entries: [],
    });

    expect(resultado.days.map((d) => d.isBusinessDay)).toEqual([false, false, true]);
  });
});

describe("janelas D+30, D+60 e D+90", () => {
  it("projeta o horizonte pedido", () => {
    const base = { openingBalance: fromDb("10000.00"), entries: [] as ProjectionEntry[] };

    expect(projectHorizon(base, "2025-03-01", 30).days).toHaveLength(31);
    expect(projectHorizon(base, "2025-03-01", 60).days).toHaveLength(61);
    expect(projectHorizon(base, "2025-03-01", 90).days.at(-1)?.date).toBe("2025-05-30");
  });
});

describe("expansao de recorrencia", () => {
  it("gera um previsto por mes", () => {
    const previstos = expandRecurrence(
      {
        startDate: "2025-01-10",
        frequency: "mensal",
        amount: fromDb("-3500.00"),
        description: "Aluguel",
      },
      "2025-01-01",
      "2025-04-30",
    );

    expect(previstos.map((p) => p.bookingDate)).toEqual([
      "2025-01-10",
      "2025-02-10",
      "2025-03-10",
      "2025-04-10",
    ]);
    expect(previstos.every((p) => p.status === "previsto")).toBe(true);
  });

  it("leva o vencimento dia 31 para o ultimo dia dos meses curtos", () => {
    const previstos = expandRecurrence(
      {
        startDate: "2025-01-31",
        frequency: "mensal",
        dayOfMonth: 31,
        amount: fromDb("-1000.00"),
        description: "Tributo",
      },
      "2025-01-01",
      "2025-05-31",
    );

    expect(previstos.map((p) => p.bookingDate)).toEqual([
      "2025-01-31",
      "2025-02-28", // fevereiro nao tem 31
      "2025-03-31",
      "2025-04-30", // abril nao tem 31
      "2025-05-31",
    ]);
  });

  it("respeita a data de encerramento da recorrencia", () => {
    const previstos = expandRecurrence(
      {
        startDate: "2025-01-10",
        endDate: "2025-03-01",
        frequency: "mensal",
        amount: fromDb("-500.00"),
        description: "Contrato encerrado",
      },
      "2025-01-01",
      "2025-06-30",
    );

    expect(previstos.map((p) => p.bookingDate)).toEqual(["2025-01-10", "2025-02-10"]);
  });

  it("gera semanal e quinzenal", () => {
    const semanal = expandRecurrence(
      { startDate: "2025-03-03", frequency: "semanal", amount: fromDb("-100.00"), description: "x" },
      "2025-03-01",
      "2025-03-24",
    );
    expect(semanal.map((p) => p.bookingDate)).toEqual([
      "2025-03-03",
      "2025-03-10",
      "2025-03-17",
      "2025-03-24",
    ]);

    const quinzenal = expandRecurrence(
      { startDate: "2025-03-03", frequency: "quinzenal", amount: fromDb("-100.00"), description: "x" },
      "2025-03-01",
      "2025-03-31",
    );
    expect(quinzenal.map((p) => p.bookingDate)).toEqual([
      "2025-03-03",
      "2025-03-17",
      "2025-03-31",
    ]);
  });

  it("ignora ocorrencias anteriores a janela pedida", () => {
    const previstos = expandRecurrence(
      { startDate: "2024-01-10", frequency: "mensal", amount: fromDb("-100.00"), description: "x" },
      "2025-02-01",
      "2025-03-31",
    );
    expect(previstos.map((p) => p.bookingDate)).toEqual(["2025-02-10", "2025-03-10"]);
  });
});

describe("projecao alimentada por recorrencia", () => {
  it("junta recorrencia e previstos avulsos no mesmo fluxo", () => {
    const aluguel = expandRecurrence(
      {
        startDate: "2025-03-05",
        frequency: "mensal",
        amount: fromDb("-3000.00"),
        description: "Aluguel",
      },
      "2025-03-01",
      "2025-04-30",
    );

    const resultado = project({
      openingBalance: fromDb("4000.00"),
      from: "2025-03-01",
      to: "2025-04-30",
      entries: [...aluguel, previsto("2025-03-20", "2000.00", "Recebimento")],
    });

    // 4.000 - 3.000 = 1.000 em 05/03; +2.000 = 3.000 em 20/03; -3.000 = 0 em 05/04.
    expect(toDb(resultado.finalBalance)).toBe("0.00");
    expect(resultado.firstNegativeDate).toBeNull();
    expect(toDb(resultado.days.find((d) => d.date === "2025-03-05")!.balance)).toBe("1000.00");
  });
});

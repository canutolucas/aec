import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  BankingCalendar,
  DateError,
  daysBetween,
  eachDay,
  easterSunday,
  endOfMonth,
  isIsoDate,
  nationalHolidays,
  startOfMonth,
  todayInBrazil,
} from "@/lib/domain/dates";

describe("data de caixa e dia de calendario, nao instante", () => {
  it("nao desloca a data por causa do fuso da maquina", () => {
    // O bug classico: `new Date("2025-03-01")` em fuso negativo vira 28/02 quando
    // formatado localmente. Aqui a data e string e a aritmetica e em UTC, entao a
    // virada de mes nunca escorrega.
    expect(addDays("2025-03-01", 0)).toBe("2025-03-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("atravessa a virada de ano", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("trata ano bissexto", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("valida o formato e recusa data inexistente", () => {
    expect(isIsoDate("2025-03-05")).toBe(true);
    expect(isIsoDate("2025-02-30")).toBe(false);
    expect(isIsoDate("05/03/2025")).toBe(false);
    expect(isIsoDate("2025-13-01")).toBe(false);
    expect(() => addDays("05/03/2025", 1)).toThrow(DateError);
  });
});

describe("vencimento mensal", () => {
  it("leva dia 31 para o ultimo dia dos meses mais curtos", () => {
    // Vencimento dia 31 em fevereiro e cobrado no dia 28, como o boleto de verdade.
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2025-01-31", 3)).toBe("2025-04-30");
  });

  it("preserva o dia quando ele existe no mes de destino", () => {
    expect(addMonths("2025-01-15", 1)).toBe("2025-02-15");
    expect(addMonths("2025-03-31", 2)).toBe("2025-05-31");
  });
});

describe("limites de mes", () => {
  it("calcula primeiro e ultimo dia", () => {
    expect(startOfMonth("2025-03-17")).toBe("2025-03-01");
    expect(endOfMonth("2025-03-17")).toBe("2025-03-31");
    expect(endOfMonth("2025-02-10")).toBe("2025-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29");
  });
});

describe("intervalos", () => {
  it("conta dias entre duas datas", () => {
    expect(daysBetween("2025-03-01", "2025-03-31")).toBe(30);
    expect(daysBetween("2025-03-31", "2025-03-01")).toBe(-30);
    expect(daysBetween("2025-03-01", "2025-03-01")).toBe(0);
  });

  it("nao erra por causa do horario de verao", () => {
    // Em fusos com horario de verao, um dia tem 23 ou 25 horas e a divisao por
    // 86.400.000 escorrega. O arredondamento cobre isso.
    expect(daysBetween("2025-10-01", "2025-11-01")).toBe(31);
    expect(daysBetween("2025-02-01", "2025-03-01")).toBe(28);
  });

  it("gera a sequencia inclusive nas duas pontas", () => {
    expect(eachDay("2025-03-01", "2025-03-04")).toEqual([
      "2025-03-01",
      "2025-03-02",
      "2025-03-03",
      "2025-03-04",
    ]);
    expect(eachDay("2025-03-01", "2025-03-01")).toEqual(["2025-03-01"]);
    expect(eachDay("2025-03-05", "2025-03-01")).toEqual([]);
  });
});

describe("feriados bancarios", () => {
  it("calcula a Pascoa", () => {
    expect(easterSunday(2025)).toBe("2025-04-20");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2024)).toBe("2024-03-31");
  });

  it("inclui os feriados moveis derivados da Pascoa", () => {
    const holidays = nationalHolidays(2025);
    expect(holidays.has("2025-03-03")).toBe(true); // Carnaval, segunda
    expect(holidays.has("2025-03-04")).toBe(true); // Carnaval, terca
    expect(holidays.has("2025-04-18")).toBe(true); // Sexta-feira Santa
    expect(holidays.has("2025-06-19")).toBe(true); // Corpus Christi
  });

  it("inclui os feriados fixos", () => {
    const holidays = nationalHolidays(2025);
    expect(holidays.has("2025-01-01")).toBe(true);
    expect(holidays.has("2025-09-07")).toBe(true);
    expect(holidays.has("2025-12-25")).toBe(true);
  });
});

describe("calendario bancario", () => {
  const calendar = new BankingCalendar();

  it("sabe quando o dinheiro nao anda", () => {
    expect(calendar.isBusinessDay("2025-03-05")).toBe(true); // quarta comum
    expect(calendar.isBusinessDay("2025-03-08")).toBe(false); // sabado
    expect(calendar.isBusinessDay("2025-03-09")).toBe(false); // domingo
    expect(calendar.isBusinessDay("2025-12-25")).toBe(false); // Natal
    expect(calendar.isBusinessDay("2025-03-04")).toBe(false); // Carnaval
  });

  it("avanca ate o proximo dia util", () => {
    expect(calendar.nextBusinessDay("2025-03-08")).toBe("2025-03-10"); // sabado -> segunda
    expect(calendar.nextBusinessDay("2025-03-05")).toBe("2025-03-05"); // ja e util
    // Natal de 2025 e quinta; 26 e sexta util.
    expect(calendar.nextBusinessDay("2025-12-25")).toBe("2025-12-26");
  });

  it("recua ate o dia util anterior", () => {
    expect(calendar.previousBusinessDay("2025-03-09")).toBe("2025-03-07"); // domingo -> sexta
    expect(calendar.previousBusinessDay("2025-03-05")).toBe("2025-03-05");
  });

  it("atravessa uma sequencia longa de feriado e fim de semana", () => {
    // 2025: Carnaval na segunda 03/03 e terca 04/03. Vindo do sabado 01/03,
    // o proximo dia util e a quarta-feira de cinzas, 05/03.
    expect(calendar.nextBusinessDay("2025-03-01")).toBe("2025-03-05");
  });

  it("aceita feriado municipal configurado por empresa", () => {
    // Aniversario de Sao Paulo, 25/01/2024, uma quinta-feira. Nao e feriado
    // nacional: so nao e dia util para quem esta na cidade.
    const paulistano = new BankingCalendar(["2024-01-25"]);

    expect(calendar.isBusinessDay("2024-01-25")).toBe(true);
    expect(paulistano.isBusinessDay("2024-01-25")).toBe(false);
    expect(paulistano.isHoliday("2024-01-25")).toBe(true);
    expect(paulistano.nextBusinessDay("2024-01-25")).toBe("2024-01-26");
  });
});

describe("hoje no fuso brasileiro", () => {
  it("usa a data de Sao Paulo, nao a do servidor em UTC", () => {
    // 1o de janeiro as 02:00 UTC ainda e 31 de dezembro no Brasil (UTC-3).
    const virada = new Date("2026-01-01T02:00:00Z");
    expect(todayInBrazil(virada)).toBe("2025-12-31");
  });

  it("devolve uma data ISO valida", () => {
    expect(isIsoDate(todayInBrazil())).toBe(true);
  });
});

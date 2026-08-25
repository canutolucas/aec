import { describe, expect, it } from "vitest";
import {
  allocate,
  formatAmount,
  formatBRL,
  fromDb,
  fromDecimal,
  MoneyError,
  parseUserInput,
  sum,
  toDb,
  toDecimal,
} from "@/lib/domain/money";

describe("fronteira com o banco", () => {
  it("le o numeric(14,2) que o driver entrega como string", () => {
    expect(fromDb("1234.56")).toBe(123456);
    expect(fromDb("-1800.00")).toBe(-180000);
    expect(fromDb("0.01")).toBe(1);
    expect(fromDb("10000")).toBe(1000000);
  });

  it("trata nulo como zero", () => {
    expect(fromDb(null)).toBe(0);
    expect(fromDb(undefined)).toBe(0);
  });

  it("devolve string que o Postgres aceita como numeric", () => {
    expect(toDb(123456)).toBe("1234.56");
    expect(toDb(-180000)).toBe("-1800.00");
    expect(toDb(1)).toBe("0.01");
    expect(toDb(-1)).toBe("-0.01");
    expect(toDb(0)).toBe("0.00");
    expect(toDb(100)).toBe("1.00");
  });

  it("fecha o ciclo banco -> centavos -> banco sem perder nada", () => {
    for (const value of ["0.00", "0.01", "-0.01", "9999.99", "-1234.05", "1000000.00"]) {
      expect(toDb(fromDb(value))).toBe(value);
    }
  });
});

describe("a razao de existir dos centavos", () => {
  it("soma 0,10 + 0,20 dando exatamente 0,30", () => {
    // Em ponto flutuante isto daria 0.30000000000000004 e o mes fecharia com
    // diferenca de centavo. E o bug que este modulo inteiro existe para evitar.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sum([fromDb("0.10"), fromDb("0.20")])).toBe(fromDb("0.30"));
    expect(toDb(sum([fromDb("0.10"), fromDb("0.20")]))).toBe("0.30");
  });

  it("soma mil centavos sem acumular erro", () => {
    const values = Array.from({ length: 1000 }, () => fromDb("0.01"));
    expect(toDb(sum(values))).toBe("10.00");
  });

  it("mantem exatidao em um extrato longo de valores quebrados", () => {
    const extrato = ["1234.56", "-987.65", "0.03", "-0.01", "45678.90", "-45678.90"];
    const total = sum(extrato.map(fromDb));
    expect(toDb(total)).toBe("246.93");
  });
});

describe("arredondamento", () => {
  it("arredonda meio centavo para cima em vez de truncar", () => {
    expect(fromDb("1.005")).toBe(101);
    expect(fromDb("2.345")).toBe(235);
  });

  it("arredonda para baixo abaixo do meio centavo", () => {
    expect(fromDb("1.004")).toBe(100);
    expect(fromDb("2.344")).toBe(234);
  });

  it("converte decimal de ponto flutuante sem cair no erro do float", () => {
    expect(fromDecimal(1.005)).toBe(101);
    expect(fromDecimal(0.07)).toBe(7);
    expect(fromDecimal(1234.56)).toBe(123456);
    expect(fromDecimal(-0.29)).toBe(-29);
  });

  it("volta para decimal quando precisa exibir", () => {
    expect(toDecimal(123456)).toBe(1234.56);
    expect(toDecimal(-1)).toBe(-0.01);
  });
});

describe("o que o usuario digita vindo do Excel", () => {
  it("aceita o formato brasileiro com milhar e virgula", () => {
    expect(parseUserInput("1.234,56")).toBe(123456);
    expect(parseUserInput("1.234.567,89")).toBe(123456789);
    expect(parseUserInput("1234,56")).toBe(123456);
  });

  it("aceita ponto como decimal quando nao ha virgula", () => {
    expect(parseUserInput("1234.56")).toBe(123456);
    expect(parseUserInput("12.50")).toBe(1250);
  });

  it("le ponto como milhar quando separa tres digitos", () => {
    // "1.234" e mil duzentos e trinta e quatro reais, nao um real e vinte e tres.
    expect(parseUserInput("1.234")).toBe(123400);
    expect(parseUserInput("1.234.567")).toBe(123456700);
  });

  it("aceita simbolo de moeda e espacos", () => {
    expect(parseUserInput("R$ 1.234,56")).toBe(123456);
    expect(parseUserInput("  R$1234,56  ")).toBe(123456);
  });

  it("entende negativo com sinal e com parenteses da notacao contabil", () => {
    expect(parseUserInput("-1.234,56")).toBe(-123456);
    expect(parseUserInput("(1.234,56)")).toBe(-123456);
    expect(parseUserInput("(R$ 50,00)")).toBe(-5000);
  });

  it("aceita inteiro puro", () => {
    expect(parseUserInput("50")).toBe(5000);
    expect(parseUserInput("0")).toBe(0);
  });

  it("recusa o que nao e valor, em vez de devolver NaN silencioso", () => {
    for (const input of ["", "   ", "abc", "12,34,56", "R$", "1e5", "--5"]) {
      expect(() => parseUserInput(input), `deveria recusar "${input}"`).toThrow(MoneyError);
    }
  });
});

describe("parcelamento", () => {
  it("reparte sem perder nem inventar centavo", () => {
    const parcelas = allocate(10000, 3);
    expect(parcelas).toEqual([3334, 3333, 3333]);
    expect(sum(parcelas)).toBe(10000);
  });

  it("mantem a soma exata para qualquer numero de parcelas", () => {
    for (let parts = 1; parts <= 24; parts++) {
      for (const total of [10000, 99999, 1, 7, 123456789]) {
        expect(sum(allocate(total, parts)), `${total} em ${parts}x`).toBe(total);
      }
    }
  });

  it("preserva o sinal ao repartir uma saida", () => {
    const parcelas = allocate(-10000, 3);
    expect(parcelas).toEqual([-3334, -3333, -3333]);
    expect(sum(parcelas)).toBe(-10000);
  });

  it("recusa numero de parcelas invalido", () => {
    expect(() => allocate(100, 0)).toThrow(MoneyError);
    expect(() => allocate(100, -1)).toThrow(MoneyError);
    expect(() => allocate(100, 1.5)).toThrow(MoneyError);
  });
});

describe("formatacao", () => {
  it("formata como moeda brasileira", () => {
    // O separador do Intl e espaco estreito nao separavel, nao espaco comum.
    expect(formatBRL(123456).replace(/ /g, " ")).toBe("R$ 1.234,56");
    expect(formatBRL(-180000).replace(/ /g, " ")).toBe("-R$ 1.800,00");
    expect(formatBRL(0).replace(/ /g, " ")).toBe("R$ 0,00");
  });

  it("formata sem simbolo para grades densas", () => {
    expect(formatAmount(123456)).toBe("1.234,56");
    expect(formatAmount(-1)).toBe("-0,01");
  });
});

describe("limites", () => {
  it("recusa valor nao finito", () => {
    expect(() => fromDecimal(Number.NaN)).toThrow(MoneyError);
    expect(() => fromDecimal(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it("acusa estouro em vez de devolver numero impreciso", () => {
    expect(() => toDb(Number.MAX_SAFE_INTEGER)).toThrow(MoneyError);
  });
});

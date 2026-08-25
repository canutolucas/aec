import { describe, expect, it } from "vitest";
import {
  type CategorizationRule,
  categorize,
  directionOf,
  matchingRules,
  orderRules,
  suggestRuleText,
} from "@/lib/domain/rules";
import { fromDb } from "@/lib/domain/money";

function regra(overrides: Partial<CategorizationRule> & { id: string; matchText: string }): CategorizationRule {
  return {
    priority: 100,
    isActive: true,
    ...overrides,
  };
}

const CONTA = "conta-itau";

describe("aplicacao de regra", () => {
  it("categoriza pelo texto contido no memo", () => {
    const resultado = categorize(
      { memo: "PIX ENVIADO ALUGUEL MARCO", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [regra({ id: "r1", matchText: "aluguel", categoryId: "cat-aluguel" })],
    );

    expect(resultado.categoryId).toBe("cat-aluguel");
    expect(resultado.appliedRuleId).toBe("r1");
  });

  it("ignora acento e caixa no memo e na regra", () => {
    const resultado = categorize(
      { memo: "PAGTO ENERGIA ELÉTRICA", amount: fromDb("-450.00"), bankAccountId: CONTA },
      [regra({ id: "r1", matchText: "energia eletrica", categoryId: "cat-energia" })],
    );

    expect(resultado.categoryId).toBe("cat-energia");
  });

  it("devolve vazio quando nenhuma regra casa", () => {
    const resultado = categorize(
      { memo: "COMPRA CARTAO", amount: fromDb("-50.00"), bankAccountId: CONTA },
      [regra({ id: "r1", matchText: "aluguel", categoryId: "cat-aluguel" })],
    );

    expect(resultado.categoryId).toBeNull();
    expect(resultado.appliedRuleId).toBeNull();
  });

  it("ignora regra desativada", () => {
    const resultado = categorize(
      { memo: "ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [regra({ id: "r1", matchText: "aluguel", categoryId: "cat-aluguel", isActive: false })],
    );

    expect(resultado.categoryId).toBeNull();
  });

  it("preenche contraparte e centro de custo junto com a categoria", () => {
    const resultado = categorize(
      { memo: "PIX IMOBILIARIA CENTRAL", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [
        regra({
          id: "r1",
          matchText: "imobiliaria central",
          categoryId: "cat-aluguel",
          counterpartyId: "cp-imobiliaria",
          costCenterId: "cc-matriz",
        }),
      ],
    );

    expect(resultado).toMatchObject({
      categoryId: "cat-aluguel",
      counterpartyId: "cp-imobiliaria",
      costCenterId: "cc-matriz",
    });
  });
});

describe("escopo da regra", () => {
  it("respeita a restricao por conta bancaria", () => {
    const rules = [
      regra({ id: "r1", matchText: "tarifa", categoryId: "cat-tarifa-itau", bankAccountId: CONTA }),
    ];

    expect(
      categorize({ memo: "TARIFA MENSAL", amount: fromDb("-99.90"), bankAccountId: CONTA }, rules)
        .categoryId,
    ).toBe("cat-tarifa-itau");

    expect(
      categorize(
        { memo: "TARIFA MENSAL", amount: fromDb("-99.90"), bankAccountId: "conta-bradesco" },
        rules,
      ).categoryId,
    ).toBeNull();
  });

  it("respeita a restricao por sentido", () => {
    // "PIX" aparece nos dois sentidos; a regra so vale para o que ela declarou.
    const rules = [
      regra({ id: "r-saida", matchText: "pix", categoryId: "cat-saida", direction: "saida" }),
    ];

    expect(
      categorize({ memo: "PIX ENVIADO", amount: fromDb("-100.00"), bankAccountId: CONTA }, rules)
        .categoryId,
    ).toBe("cat-saida");

    expect(
      categorize({ memo: "PIX RECEBIDO", amount: fromDb("100.00"), bankAccountId: CONTA }, rules)
        .categoryId,
    ).toBeNull();
  });

  it("regra sem restricao vale para qualquer conta e sentido", () => {
    const rules = [regra({ id: "r1", matchText: "juros", categoryId: "cat-juros" })];

    expect(
      categorize({ memo: "JUROS", amount: fromDb("10.00"), bankAccountId: "qualquer" }, rules)
        .categoryId,
    ).toBe("cat-juros");
    expect(
      categorize({ memo: "JUROS", amount: fromDb("-10.00"), bankAccountId: "outra" }, rules)
        .categoryId,
    ).toBe("cat-juros");
  });
});

describe("precedencia entre regras", () => {
  it("prioridade menor roda primeiro", () => {
    const resultado = categorize(
      { memo: "PIX ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [
        regra({ id: "generica", matchText: "pix", categoryId: "cat-generica", priority: 200 }),
        regra({ id: "especifica", matchText: "aluguel", categoryId: "cat-aluguel", priority: 10 }),
      ],
    );

    expect(resultado.appliedRuleId).toBe("especifica");
  });

  it("no empate de prioridade, o texto mais longo vence", () => {
    // "PIX ENVIADO ALUGUEL" e mais especifico que "PIX". Sem este criterio, a
    // regra generica cadastrada antes venceria e categorizaria tudo errado.
    const resultado = categorize(
      { memo: "PIX ENVIADO ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [
        regra({ id: "curta", matchText: "pix", categoryId: "cat-generica" }),
        regra({ id: "longa", matchText: "pix enviado aluguel", categoryId: "cat-aluguel" }),
      ],
    );

    expect(resultado.appliedRuleId).toBe("longa");
    expect(resultado.categoryId).toBe("cat-aluguel");
  });

  it("ordena de forma estavel e previsivel", () => {
    const ordenadas = orderRules([
      regra({ id: "c", matchText: "aa", priority: 50 }),
      regra({ id: "a", matchText: "aaaa", priority: 10 }),
      regra({ id: "b", matchText: "aa", priority: 10 }),
    ]);

    expect(ordenadas.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("lista todas as regras que casam, para a tela explicar o porque", () => {
    const casadas = matchingRules(
      { memo: "PIX ENVIADO ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [
        regra({ id: "curta", matchText: "pix", categoryId: "c1" }),
        regra({ id: "longa", matchText: "pix enviado aluguel", categoryId: "c2" }),
        regra({ id: "outra", matchText: "energia", categoryId: "c3" }),
      ],
    );

    expect(casadas.map((r) => r.id)).toEqual(["longa", "curta"]);
  });
});

describe("sentido do valor", () => {
  it("deriva do sinal", () => {
    expect(directionOf(fromDb("100.00"))).toBe("entrada");
    expect(directionOf(fromDb("-100.00"))).toBe("saida");
  });
});

describe("proposta de regra a partir do memo", () => {
  it("descarta o jargao bancario e fica com a parte estavel", () => {
    // O memo bruto nunca se repete identico; o que se repete e o nome.
    expect(suggestRuleText("PIX ENVIADO 12/03 JOAO SILVA 998877")).toBe("joao silva");
    expect(suggestRuleText("TED RECEBIDA IMOBILIARIA CENTRAL LTDA")).toBe(
      "imobiliaria central ltda",
    );
  });

  it("descarta numeros soltos, que mudam a cada lancamento", () => {
    expect(suggestRuleText("PAGAMENTO BOLETO 123456789 ENERGISA")).toBe("energisa");
  });

  it("limita a tres palavras, para nao ficar especifica demais", () => {
    const proposta = suggestRuleText("SUPERMERCADO ATACADISTA REGIONAL FILIAL CENTRO NORTE");
    expect(proposta.split(" ")).toHaveLength(3);
    expect(proposta).toBe("supermercado atacadista regional");
  });

  it("devolve vazio quando o memo so tem jargao", () => {
    expect(suggestRuleText("PIX ENVIADO")).toBe("");
    expect(suggestRuleText("")).toBe("");
  });

  it("a proposta gerada realmente casa com o memo de origem", () => {
    // A propriedade que importa: a regra sugerida tem de funcionar.
    const memo = "TED RECEBIDA IMOBILIARIA CENTRAL LTDA 4455";
    const texto = suggestRuleText(memo);

    const resultado = categorize(
      { memo, amount: fromDb("-3500.00"), bankAccountId: CONTA },
      [regra({ id: "gerada", matchText: texto, categoryId: "cat-aluguel" })],
    );

    expect(resultado.categoryId).toBe("cat-aluguel");
  });
});

describe("nome de mes na proposta de regra", () => {
  it("e descartado, porque muda todo mes", () => {
    // Uma regra "aluguel marco" para de casar em abril, e quem opera conclui que
    // o sistema desaprendeu.
    expect(suggestRuleText("PAGAMENTO ALUGUEL MARCO")).toBe("aluguel");
    expect(suggestRuleText("HONORARIOS REFERENTE A JANEIRO")).toBe("honorarios");
  });

  it("a regra proposta continua casando no mes seguinte", () => {
    const memoDeMarco = "PAGAMENTO BOLETO IMOBILIARIA CENTRAL ALUGUEL MARCO";
    const memoDeAbril = "PAGAMENTO BOLETO IMOBILIARIA CENTRAL ALUGUEL ABRIL";

    const texto = suggestRuleText(memoDeMarco);
    const regras = [regra({ id: "gerada", matchText: texto, categoryId: "cat-aluguel" })];

    expect(
      categorize({ memo: memoDeAbril, amount: fromDb("-1800.00"), bankAccountId: CONTA }, regras)
        .categoryId,
    ).toBe("cat-aluguel");
  });
});

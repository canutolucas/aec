import { describe, expect, it } from "vitest";

import { fromDb } from "../src/money";
import {
  type CategorizationRule,
  categorize,
  directionOf,
  matchingRules,
  orderRules,
  suggestRuleText,
} from "../src/rules";

function rule(
  overrides: Partial<CategorizationRule> & { id: string; matchText: string },
): CategorizationRule {
  return {
    priority: 100,
    isActive: true,
    ...overrides,
  };
}

const ACCOUNT = "itau-account";

describe("applying a rule", () => {
  it("categorizes by text contained in the memo", () => {
    const result = categorize(
      { memo: "PIX ENVIADO ALUGUEL MARCO", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [rule({ id: "r1", matchText: "aluguel", categoryId: "cat-rent" })],
    );

    expect(result.categoryId).toBe("cat-rent");
    expect(result.appliedRuleId).toBe("r1");
  });

  it("ignores accent and case in both the memo and the rule", () => {
    const result = categorize(
      { memo: "PAGTO ENERGIA ELÉTRICA", amount: fromDb("-450.00"), bankAccountId: ACCOUNT },
      [rule({ id: "r1", matchText: "energia eletrica", categoryId: "cat-utilities" })],
    );

    expect(result.categoryId).toBe("cat-utilities");
  });

  it("returns empty when no rule matches", () => {
    const result = categorize(
      { memo: "COMPRA CARTAO", amount: fromDb("-50.00"), bankAccountId: ACCOUNT },
      [rule({ id: "r1", matchText: "aluguel", categoryId: "cat-rent" })],
    );

    expect(result.categoryId).toBeNull();
    expect(result.appliedRuleId).toBeNull();
  });

  it("ignores a disabled rule", () => {
    const result = categorize(
      { memo: "ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [rule({ id: "r1", matchText: "aluguel", categoryId: "cat-rent", isActive: false })],
    );

    expect(result.categoryId).toBeNull();
  });

  it("fills in counterparty and cost center along with the category", () => {
    const result = categorize(
      { memo: "PIX IMOBILIARIA CENTRAL", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [
        rule({
          id: "r1",
          matchText: "imobiliaria central",
          categoryId: "cat-rent",
          counterpartyId: "cp-landlord",
          costCenterId: "cc-hq",
        }),
      ],
    );

    expect(result).toMatchObject({
      categoryId: "cat-rent",
      counterpartyId: "cp-landlord",
      costCenterId: "cc-hq",
    });
  });
});

describe("rule scope", () => {
  it("respects the restriction by bank account", () => {
    const rules = [
      rule({ id: "r1", matchText: "tarifa", categoryId: "cat-fee-itau", bankAccountId: ACCOUNT }),
    ];

    expect(
      categorize({ memo: "TARIFA MENSAL", amount: fromDb("-99.90"), bankAccountId: ACCOUNT }, rules)
        .categoryId,
    ).toBe("cat-fee-itau");

    expect(
      categorize(
        { memo: "TARIFA MENSAL", amount: fromDb("-99.90"), bankAccountId: "bradesco-account" },
        rules,
      ).categoryId,
    ).toBeNull();
  });

  it("respects the restriction by direction", () => {
    // "PIX" shows up in both directions; the rule only applies to the one it declared.
    const rules = [
      rule({ id: "r-outflow", matchText: "pix", categoryId: "cat-outflow", direction: "saida" }),
    ];

    expect(
      categorize({ memo: "PIX ENVIADO", amount: fromDb("-100.00"), bankAccountId: ACCOUNT }, rules)
        .categoryId,
    ).toBe("cat-outflow");

    expect(
      categorize({ memo: "PIX RECEBIDO", amount: fromDb("100.00"), bankAccountId: ACCOUNT }, rules)
        .categoryId,
    ).toBeNull();
  });

  it("a rule with no restriction applies to any account and direction", () => {
    const rules = [rule({ id: "r1", matchText: "juros", categoryId: "cat-interest" })];

    expect(
      categorize({ memo: "JUROS", amount: fromDb("10.00"), bankAccountId: "any" }, rules)
        .categoryId,
    ).toBe("cat-interest");
    expect(
      categorize({ memo: "JUROS", amount: fromDb("-10.00"), bankAccountId: "another" }, rules)
        .categoryId,
    ).toBe("cat-interest");
  });
});

describe("precedence between rules", () => {
  it("lower priority runs first", () => {
    const result = categorize(
      { memo: "PIX ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [
        rule({ id: "generic", matchText: "pix", categoryId: "cat-generic", priority: 200 }),
        rule({ id: "specific", matchText: "aluguel", categoryId: "cat-rent", priority: 10 }),
      ],
    );

    expect(result.appliedRuleId).toBe("specific");
  });

  it("on a priority tie, the longer text wins", () => {
    // "PIX ENVIADO ALUGUEL" is more specific than "PIX". Without this
    // criterion, the generic rule registered first would win and
    // categorize everything wrong.
    const result = categorize(
      { memo: "PIX ENVIADO ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [
        rule({ id: "short", matchText: "pix", categoryId: "cat-generic" }),
        rule({ id: "long", matchText: "pix enviado aluguel", categoryId: "cat-rent" }),
      ],
    );

    expect(result.appliedRuleId).toBe("long");
    expect(result.categoryId).toBe("cat-rent");
  });

  it("orders stably and predictably", () => {
    const ordered = orderRules([
      rule({ id: "c", matchText: "aa", priority: 50 }),
      rule({ id: "a", matchText: "aaaa", priority: 10 }),
      rule({ id: "b", matchText: "aa", priority: 10 }),
    ]);

    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("lists every matching rule, so the screen can explain why", () => {
    const matched = matchingRules(
      { memo: "PIX ENVIADO ALUGUEL", amount: fromDb("-3500.00"), bankAccountId: ACCOUNT },
      [
        rule({ id: "short", matchText: "pix", categoryId: "c1" }),
        rule({ id: "long", matchText: "pix enviado aluguel", categoryId: "c2" }),
        rule({ id: "other", matchText: "energia", categoryId: "c3" }),
      ],
    );

    expect(matched.map((r) => r.id)).toEqual(["long", "short"]);
  });
});

describe("direction of the amount", () => {
  it("derives from the sign", () => {
    expect(directionOf(fromDb("100.00"))).toBe("entrada");
    expect(directionOf(fromDb("-100.00"))).toBe("saida");
  });
});

describe("rule proposal from the memo", () => {
  it("discards banking jargon and keeps the stable part", () => {
    // The raw memo never repeats identically; what repeats is the name.
    expect(suggestRuleText("PIX ENVIADO 12/03 JOAO SILVA 998877")).toBe("joao silva");
    expect(suggestRuleText("TED RECEBIDA IMOBILIARIA CENTRAL LTDA")).toBe(
      "imobiliaria central ltda",
    );
  });

  it("discards bare numbers, which change on every transaction", () => {
    expect(suggestRuleText("PAGAMENTO BOLETO 123456789 ENERGISA")).toBe("energisa");
  });

  it("caps at three words, so it doesn't get too specific", () => {
    const proposal = suggestRuleText("SUPERMERCADO ATACADISTA REGIONAL FILIAL CENTRO NORTE");
    expect(proposal.split(" ")).toHaveLength(3);
    expect(proposal).toBe("supermercado atacadista regional");
  });

  it("returns empty when the memo is only jargon", () => {
    expect(suggestRuleText("PIX ENVIADO")).toBe("");
    expect(suggestRuleText("")).toBe("");
  });

  it("the generated proposal actually matches the source memo", () => {
    // The property that matters: the suggested rule has to work.
    const memo = "TED RECEBIDA IMOBILIARIA CENTRAL LTDA 4455";
    const text = suggestRuleText(memo);

    const result = categorize({ memo, amount: fromDb("-3500.00"), bankAccountId: ACCOUNT }, [
      rule({ id: "generated", matchText: text, categoryId: "cat-rent" }),
    ]);

    expect(result.categoryId).toBe("cat-rent");
  });
});

describe("month name in the rule proposal", () => {
  it("is discarded, because it changes every month", () => {
    // A rule "aluguel marco" (rent march) would stop matching in April, and
    // whoever operates the system would conclude it had forgotten.
    expect(suggestRuleText("PAGAMENTO ALUGUEL MARCO")).toBe("aluguel");
    expect(suggestRuleText("HONORARIOS REFERENTE A JANEIRO")).toBe("honorarios");
  });

  it("the proposed rule keeps matching the following month", () => {
    const marchMemo = "PAGAMENTO BOLETO IMOBILIARIA CENTRAL ALUGUEL MARCO";
    const aprilMemo = "PAGAMENTO BOLETO IMOBILIARIA CENTRAL ALUGUEL ABRIL";

    const text = suggestRuleText(marchMemo);
    const rules = [rule({ id: "generated", matchText: text, categoryId: "cat-rent" })];

    expect(
      categorize({ memo: aprilMemo, amount: fromDb("-1800.00"), bankAccountId: ACCOUNT }, rules)
        .categoryId,
    ).toBe("cat-rent");
  });
});

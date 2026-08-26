import { describe, expect, it } from "vitest";

import { planAutoApply } from "../src/auto-apply";
import type { MatchableTransaction, StatementLine } from "../src/matching";
import { fromDb } from "../src/money";
import type { CategorizationRule } from "../src/rules";

const ACCOUNT = "conta-itau";

function line(id: string, postedAt: string, amount: string, memo: string): StatementLine {
  return { id, postedAt, amount: fromDb(amount), memo };
}

function transaction(
  id: string,
  bookingDate: string,
  amount: string,
  description: string,
): MatchableTransaction {
  return { id, bookingDate, amount: fromDb(amount), description };
}

function rule(overrides: Partial<CategorizationRule> & { id: string; matchText: string }) {
  return { priority: 100, isActive: true, ...overrides };
}

describe("planAutoApply", () => {
  it("auto-reconcilia um pareamento exato, sem excecao nenhuma", () => {
    const plan = planAutoApply(
      [line("l1", "2026-08-05", "-150.00", "PIX ENVIADO ALUGUEL")],
      [transaction("t1", "2026-08-05", "-150.00", "Aluguel agosto")],
      [],
      ACCOUNT,
    );

    expect(plan.reconcile).toEqual([{ lineId: "l1", transactionId: "t1" }]);
    expect(plan.create).toEqual([]);
    expect(plan.exceptions.suggested).toEqual([]);
    expect(plan.exceptions.uncategorized).toEqual([]);
  });

  it("auto-lanca uma linha sem contrapartida quando uma regra aprendida traz categoria", () => {
    const plan = planAutoApply(
      [line("l1", "2026-08-05", "-89.90", "PIX ENVIADO NETFLIX")],
      [],
      [rule({ id: "r1", matchText: "netflix", categoryId: "cat-assinaturas" })],
      ACCOUNT,
    );

    expect(plan.reconcile).toEqual([]);
    expect(plan.create).toEqual([{ lineId: "l1", categoryId: "cat-assinaturas", ruleId: "r1" }]);
    expect(plan.exceptions.uncategorized).toEqual([]);
  });

  it("nunca auto-concilia um pareamento so 'provavel' — vira excecao", () => {
    const plan = planAutoApply(
      // 10 dias de diferenca: fora da tolerancia "exact" (3 dias), dentro da "likely" (30).
      [line("l1", "2026-08-15", "-500.00", "TRANSFERENCIA")],
      [transaction("t1", "2026-08-05", "-500.00", "Pagamento diverso")],
      [],
      ACCOUNT,
    );

    expect(plan.reconcile).toEqual([]);
    expect(plan.exceptions.suggested).toHaveLength(1);
    expect(plan.exceptions.suggested[0]).toMatchObject({ lineId: "l1", transactionId: "t1" });
  });

  it("linha sem pareamento e sem regra que bata vira excecao 'sem categoria'", () => {
    const linhaSemRegra = line("l1", "2026-08-05", "-40.00", "COMPRA CARTAO DEBITO");
    const plan = planAutoApply([linhaSemRegra], [], [], ACCOUNT);

    expect(plan.reconcile).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.exceptions.uncategorized).toEqual([linhaSemRegra]);
  });

  it("regra que bate mas so tem contraparte, sem categoria, tambem vira excecao", () => {
    // Uma regra pode existir so para preencher contraparte/centro de custo,
    // sem categoria nenhuma — nesse caso nao ha o que auto-lancar: falta
    // exatamente o campo que create_transaction_from_line precisa.
    const linha = line("l1", "2026-08-05", "-40.00", "PIX ENVIADO JOAO SILVA");
    const plan = planAutoApply(
      [linha],
      [],
      [rule({ id: "r1", matchText: "joao silva", counterpartyId: "pessoa-joao" })],
      ACCOUNT,
    );

    expect(plan.create).toEqual([]);
    expect(plan.exceptions.uncategorized).toEqual([linha]);
  });

  it("uma conta bancaria diferente na regra nao se aplica", () => {
    const linha = line("l1", "2026-08-05", "-40.00", "PIX ENVIADO NETFLIX");
    const plan = planAutoApply(
      [linha],
      [],
      [rule({ id: "r1", matchText: "netflix", categoryId: "cat-x", bankAccountId: "outra-conta" })],
      ACCOUNT,
    );

    expect(plan.create).toEqual([]);
    expect(plan.exceptions.uncategorized).toEqual([linha]);
  });
});

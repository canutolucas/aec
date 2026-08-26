/**
 * Fluxo simples: depois de subir o extrato, resolve sozinho tudo que da para
 * resolver com confianca alta — sem clique nenhum — e devolve so o que
 * sobrou como excecao de verdade.
 *
 * Deliberadamente NAO inventa um terceiro nivel de confianca nem um limiar de
 * hit_count: usa exatamente as duas distincoes binarias que o codigo ja
 * calcula.
 *
 *  - matchStatement(): "exact" auto-concilia; "likely" nunca e automatico —
 *    e a mesma decisao de projeto documentada em matching.ts (um algoritmo
 *    que casa tudo sozinho esconde erro).
 *  - categorize(): uma regra aprendida bateu (appliedRuleId + categoryId) ou
 *    nao bateu nada. Uma regra pode ter so contraparte/centro de custo, sem
 *    categoria — nesse caso tambem fica excecao, porque nao ha categoria
 *    para lancar automaticamente.
 */

import {
  type Match,
  type MatchableTransaction,
  matchStatement,
  type StatementLine,
} from "./matching";
import { type CategorizationRule,categorize } from "./rules";

export interface AutoApplyReconcile {
  readonly lineId: string;
  readonly transactionId: string;
}

export interface AutoApplyCreate {
  readonly lineId: string;
  readonly categoryId: string;
  readonly ruleId: string;
}

export interface AutoApplyPlan {
  /** Pareamento exato: aplicar reconcile_line sem perguntar. */
  readonly reconcile: readonly AutoApplyReconcile[];
  /** Regra aprendida com categoria: aplicar create_transaction_from_line sem perguntar. */
  readonly create: readonly AutoApplyCreate[];
  readonly exceptions: {
    /** Pareamento so "provavel" — sempre exige confirmacao de uma pessoa. */
    readonly suggested: readonly Match[];
    /** Sem pareamento e sem regra com categoria: precisa de uma categoria escolhida a mao. */
    readonly uncategorized: readonly StatementLine[];
  };
}

/**
 * Decide o que auto-aplicar para as linhas de UMA conta bancaria.
 *
 * `bankAccountId` e um unico valor, nao um campo por linha: quem chama isto
 * (autoApplyReconciliation) ja opera sobre uma conta por vez, e e o que
 * `categorize()` precisa para filtrar regras restritas a uma conta
 * especifica.
 */
export function planAutoApply(
  lines: readonly StatementLine[],
  transactions: readonly MatchableTransaction[],
  rules: readonly CategorizationRule[],
  bankAccountId: string,
): AutoApplyPlan {
  const result = matchStatement(lines, transactions);

  const reconcile = result.matched.map((match) => ({
    lineId: match.lineId,
    transactionId: match.transactionId,
  }));

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const create: AutoApplyCreate[] = [];
  const uncategorized: StatementLine[] = [];

  for (const unmatched of result.unmatchedLines) {
    const line = lineById.get(unmatched.id);
    if (!line) continue;

    const categorization = categorize(
      { memo: line.memo, amount: line.amount, bankAccountId },
      rules,
    );

    if (categorization.appliedRuleId && categorization.categoryId) {
      create.push({
        lineId: line.id,
        categoryId: categorization.categoryId,
        ruleId: categorization.appliedRuleId,
      });
    } else {
      uncategorized.push(line);
    }
  }

  return {
    reconcile,
    create,
    exceptions: { suggested: result.suggested, uncategorized },
  };
}

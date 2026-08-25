/**
 * Regras aprendidas de categorizacao.
 *
 * Ao conciliar, quem opera confirma "esta linha e aluguel". O sistema oferece
 * guardar isso como regra, e da importacao seguinte em diante a linha ja chega
 * categorizada. E o que faz a conciliacao ficar mais barata a cada mes, em vez
 * de custar sempre o mesmo — a diferenca entre uma ferramenta que aprende e uma
 * planilha que so registra.
 *
 * As regras sao deliberadamente simples e legiveis: texto contido no memo, com
 * prioridade explicita. Quem usa precisa conseguir prever e corrigir o que o
 * sistema vai fazer; um modelo que acerta mais mas nao se explica seria pior
 * aqui, porque o erro so apareceria no relatorio do cliente.
 */

import { normalizeText } from "./matching";
import type { Cents } from "./money";

export type Direction = "entrada" | "saida";

export interface CategorizationRule {
  readonly id: string;
  /** Texto procurado no memo do extrato. */
  readonly matchText: string;
  /** Nulo vale para qualquer conta. */
  readonly bankAccountId?: string | null;
  /** Nulo vale para os dois sentidos. */
  readonly direction?: Direction | null;
  readonly categoryId?: string | null;
  readonly counterpartyId?: string | null;
  readonly costCenterId?: string | null;
  /** Menor roda primeiro. Empate e desfeito pelo texto mais longo. */
  readonly priority: number;
  readonly isActive: boolean;
}

export interface Categorizable {
  readonly memo: string;
  readonly amount: Cents;
  readonly bankAccountId: string;
}

export interface Categorization {
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  readonly costCenterId: string | null;
  readonly appliedRuleId: string | null;
}

const NOTHING: Categorization = {
  categoryId: null,
  counterpartyId: null,
  costCenterId: null,
  appliedRuleId: null,
};

export function directionOf(amount: Cents): Direction {
  return amount > 0 ? "entrada" : "saida";
}

function ruleApplies(rule: CategorizationRule, item: Categorizable): boolean {
  if (!rule.isActive) return false;

  if (rule.bankAccountId != null && rule.bankAccountId !== item.bankAccountId) {
    return false;
  }

  if (rule.direction != null && rule.direction !== directionOf(item.amount)) {
    return false;
  }

  const needle = normalizeText(rule.matchText);
  if (needle === "") return false;

  return normalizeText(item.memo).includes(needle);
}

/**
 * Ordena as regras pela ordem em que devem ser testadas.
 *
 * Prioridade menor primeiro; no empate, o texto mais longo ganha. O criterio do
 * comprimento importa: "PIX ENVIADO ALUGUEL" e mais especifico que "PIX", e a
 * regra especifica tem de vencer a generica mesmo que tenham sido cadastradas
 * com a mesma prioridade.
 */
export function orderRules(rules: readonly CategorizationRule[]): CategorizationRule[] {
  return [...rules].sort(
    (a, b) => a.priority - b.priority || b.matchText.length - a.matchText.length,
  );
}

/** Aplica a primeira regra que casar. */
export function categorize(
  item: Categorizable,
  rules: readonly CategorizationRule[],
): Categorization {
  for (const rule of orderRules(rules)) {
    if (!ruleApplies(rule, item)) continue;
    return {
      categoryId: rule.categoryId ?? null,
      counterpartyId: rule.counterpartyId ?? null,
      costCenterId: rule.costCenterId ?? null,
      appliedRuleId: rule.id,
    };
  }
  return NOTHING;
}

/** Todas as regras que casam, da mais forte para a mais fraca. Para a tela mostrar o porque. */
export function matchingRules(
  item: Categorizable,
  rules: readonly CategorizationRule[],
): CategorizationRule[] {
  return orderRules(rules).filter((rule) => ruleApplies(rule, item));
}

/**
 * Propoe o texto de uma regra nova a partir de um memo que acabou de ser
 * categorizado a mao.
 *
 * O memo bruto nao serve como regra: "PIX ENVIADO 12/03 JOAO SILVA 998877" nunca
 * mais se repete identico. O que se repete e a parte estavel — aqui, o nome.
 * Entao a proposta descarta data, valor, documento e as palavras genericas do
 * jargao bancario, e devolve o que sobra.
 */
export function suggestRuleText(memo: string): string {
  const NOISE = new Set([
    "pix", "ted", "doc", "transferencia", "transf", "pagamento", "pgto",
    "recebimento", "receb", "enviado", "enviada", "recebido", "recebida",
    "pago", "paga", "credito", "debito", "cred",
    "deb", "conta", "cc", "cp", "ag", "agencia", "banco", "boleto", "titulo",
    "cobranca", "tarifa", "liquidacao", "compensacao", "de", "da", "do", "para",
    "em", "ref", "referente", "nr", "num", "numero", "id", "aut", "autenticacao",
  ]);

  const tokens = normalizeText(memo)
    .split(" ")
    .filter((token) => token.length > 2)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !NOISE.has(token));

  // Duas ou tres palavras costumam ser especificas o bastante sem serem
  // especificas demais a ponto de nunca mais casarem.
  return tokens.slice(0, 3).join(" ");
}

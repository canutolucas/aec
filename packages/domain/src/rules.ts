/**
 * Learned categorization rules.
 *
 * While reconciling, whoever is operating the system confirms "this line is
 * rent". The system offers to save that as a rule, and from the next import
 * onward the line already arrives categorized. This is what makes
 * reconciliation get cheaper every month instead of always costing the
 * same — the difference between a tool that learns and a spreadsheet that
 * only records.
 *
 * The rules are deliberately simple and readable: text contained in the
 * memo, with an explicit priority. Whoever uses this needs to be able to
 * predict and correct what the system will do; a model that's more accurate
 * but can't explain itself would be worse here, because the mistake would
 * only show up in the client's report.
 */

import { normalizeText } from "./matching";
import type { Cents } from "./money";

/**
 * "entrada" | "saida" mirror the `app.transaction_direction` Postgres enum
 * in supabase/migrations, which this migration deliberately leaves
 * untouched.
 */
export type Direction = "entrada" | "saida";

export interface CategorizationRule {
  readonly id: string;
  /** Text searched for in the statement memo. */
  readonly matchText: string;
  /** Null applies to any account. */
  readonly bankAccountId?: string | null;
  /** Null applies to both directions. */
  readonly direction?: Direction | null;
  readonly categoryId?: string | null;
  readonly counterpartyId?: string | null;
  readonly costCenterId?: string | null;
  /** Lower runs first. Ties are broken by the longer text. */
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
 * Orders the rules in the sequence they should be tested.
 *
 * Lower priority first; ties are broken by the longer text winning. The
 * length criterion matters: "PIX ENVIADO ALUGUEL" is more specific than
 * "PIX", and the specific rule has to beat the generic one even when both
 * were registered with the same priority.
 */
export function orderRules(rules: readonly CategorizationRule[]): CategorizationRule[] {
  return [...rules].sort(
    (a, b) => a.priority - b.priority || b.matchText.length - a.matchText.length,
  );
}

/** Applies the first rule that matches. */
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

/** Every rule that matches, strongest to weakest. So the screen can show why. */
export function matchingRules(
  item: Categorizable,
  rules: readonly CategorizationRule[],
): CategorizationRule[] {
  return orderRules(rules).filter((rule) => ruleApplies(rule, item));
}

/**
 * Proposes the text for a new rule from a memo that was just categorized by
 * hand.
 *
 * The raw memo doesn't work as a rule: "PIX ENVIADO 12/03 JOAO SILVA 998877"
 * never repeats identically again. What repeats is the stable part — here,
 * the name. So the proposal drops the date, the amount, the document number
 * and the generic words of banking jargon, and returns whatever is left.
 */
export function suggestRuleText(memo: string): string {
  // This list matches against real Brazilian bank statement memos, which are
  // written in Portuguese — these words stay in Portuguese on purpose; they
  // are input data being filtered, not code.
  const NOISE = new Set([
    "pix",
    "ted",
    "doc",
    "transferencia",
    "transf",
    "pagamento",
    "pgto",
    "recebimento",
    "receb",
    "enviado",
    "enviada",
    "recebido",
    "recebida",
    "pago",
    "paga",
    "credito",
    "debito",
    "cred",
    "deb",
    "conta",
    "cc",
    "cp",
    "ag",
    "agencia",
    "banco",
    "boleto",
    "titulo",
    "cobranca",
    "tarifa",
    "liquidacao",
    "compensacao",
    "de",
    "da",
    "do",
    "para",
    "em",
    "ref",
    "referente",
    "nr",
    "num",
    "numero",
    "id",
    "aut",
    "autenticacao",
    // Month names change every month. A rule containing "marco" (March) would
    // stop matching in April, and whoever operates the system would think it
    // had forgotten how to categorize.
    "janeiro",
    "fevereiro",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ]);

  const tokens = normalizeText(memo)
    .split(" ")
    .filter((token) => token.length > 2)
    .filter((token) => !/^\d+$/.test(token))
    .filter((token) => !NOISE.has(token));

  // Two or three words are usually specific enough without being so specific
  // that they never match again.
  return tokens.slice(0, 3).join(" ");
}

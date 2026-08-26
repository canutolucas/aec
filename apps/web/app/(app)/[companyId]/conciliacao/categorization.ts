/**
 * Converte o formato de dominio (@aec/domain) de matching_rules para o
 * formato que o banco expoe — compartilhado entre o Client Component
 * (conciliacao-client.tsx) e a Server Action de auto-aplicacao
 * (auto-apply-actions.ts), para os dois usarem exatamente o mesmo
 * mapeamento.
 *
 * Sem "use client": este arquivo roda tanto no servidor quanto no cliente.
 */

import type { MatchingRule } from "@aec/db";
import type { CategorizationRule } from "@aec/domain";

export function toCategorizationRule(rule: MatchingRule): CategorizationRule {
  return {
    id: rule.id,
    matchText: rule.match_text,
    bankAccountId: rule.bank_account_id,
    direction: rule.direction,
    categoryId: rule.category_id,
    counterpartyId: rule.counterparty_id,
    costCenterId: rule.cost_center_id,
    priority: rule.priority,
    isActive: rule.is_active,
  };
}

/**
 * Lista de regras de categorizacao aprendidas — extraido de
 * cadastros-client.tsx pra ser reaproveitado tambem pela rota /regras
 * (destinada a quem esta em modo simples, que nao alcanca /cadastros).
 * Puramente apresentacional: quem chama decide o que fazer ao desativar.
 */

import type { MatchingRule } from "@aec/db";
import { Button, EmptyState } from "@aec/ui";

export function RegrasList({
  matchingRules,
  categoryNameById,
  canEdit,
  disabled,
  onDeactivate,
}: {
  matchingRules: readonly MatchingRule[];
  categoryNameById: ReadonlyMap<string, string>;
  canEdit: boolean;
  disabled: boolean;
  onDeactivate: (rule: MatchingRule) => void;
}) {
  if (matchingRules.length === 0) {
    return (
      <EmptyState
        title="Nenhuma regra ainda"
        description='Regras nascem na tela de Conciliacao: ao criar um lancamento a partir de uma linha do extrato, marque "Salvar como regra".'
      />
    );
  }

  return (
    <div className="divide-border divide-y">
      {matchingRules.map((rule) => (
        <div
          key={rule.id}
          className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="grid gap-1 text-sm">
            <p className="font-medium">
              Histórico do banco contém &ldquo;{rule.match_text}&rdquo;
              {rule.category_id && categoryNameById.has(rule.category_id) && (
                <> → {categoryNameById.get(rule.category_id)}</>
              )}
            </p>
            <p className="text-muted-foreground text-xs">
              Aplicada {rule.hit_count} {rule.hit_count === 1 ? "vez" : "vezes"} · prioridade{" "}
              {rule.priority}
            </p>
          </div>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onDeactivate(rule)}
            >
              Desativar
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

"use client";

/**
 * Painel de detalhe de um lancamento. Nasceu so pra mostrar o historico do
 * extrato e uma observacao editavel (pedido da usuaria final: "nao consigo
 * lembrar do que se refere aquele valor"); agora tambem hospeda o
 * formulario de edicao completo (ver editar-lancamento-form.tsx) — corrigir
 * qualquer coisa deixou de exigir excluir e relancar.
 */

import type { BankAccount, Category, CostCenter, Counterparty } from "@aec/db";
import { PAYMENT_METHOD_LABELS } from "@aec/db";
import { fromDb } from "@aec/domain";
import { Badge, Dialog, DialogContent, DialogHeader, Money } from "@aec/ui";

import { formatDate } from "@/lib/ui/format";

import { EditarLancamentoForm } from "./editar-lancamento-form";
import type { LancamentoRow } from "./lancamentos-table";

export function DetalheLancamento({
  companyId,
  lancamento,
  podeEditar,
  contas,
  categorias,
  contrapartes,
  centrosDeCusto,
  open,
  onOpenChange,
}: {
  companyId: string;
  lancamento: LancamentoRow | null;
  podeEditar: boolean;
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  contrapartes: readonly Counterparty[];
  centrosDeCusto: readonly CostCenter[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!lancamento) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={lancamento.description}
          description={`${formatDate(lancamento.booking_date)} · ${lancamento.contaNome}`}
        />

        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Valor</span>
            <Money cents={fromDb(lancamento.amount)} className="text-lg font-semibold" />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lancamento.status === "previsto" && <Badge tone="warn">previsto</Badge>}
            {lancamento.reconciliation === "conciliado" && <Badge tone="success">conciliado</Badge>}
            {lancamento.is_transfer && <Badge tone="info">transferência</Badge>}
            {lancamento.temBaixaDeNota && <Badge tone="info">baixa de nota</Badge>}
            {lancamento.categoriaNome && <Badge tone="neutral">{lancamento.categoriaNome}</Badge>}
            {lancamento.payment_method && (
              <Badge tone="neutral">{PAYMENT_METHOD_LABELS[lancamento.payment_method]}</Badge>
            )}
          </div>

          {lancamento.memoExtrato && (
            <div className="bg-muted rounded-md p-3">
              <p className="text-muted-foreground text-xs">Histórico original do banco</p>
              <p className="mt-1 text-sm">{lancamento.memoExtrato}</p>
            </div>
          )}

          {podeEditar ? (
            <EditarLancamentoForm
              companyId={companyId}
              lancamento={lancamento}
              contas={contas}
              categorias={categorias}
              contrapartes={contrapartes}
              centrosDeCusto={centrosDeCusto}
              onSaved={() => onOpenChange(false)}
            />
          ) : (
            lancamento.document_number && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Documento</span>
                <span>{lancamento.document_number}</span>
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

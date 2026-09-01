"use client";

import { ConfirmDialog } from "@aec/ui";
import { useState } from "react";

import { excluirLancamento } from "@/lib/db/transactions";

import { BaixaDialog } from "./baixa-dialog";
import type { LancamentoRow } from "./lancamentos-table";

/** Row actions for one transaction: settle a forecast, undo it, or delete it. */
export function AcoesLancamento({
  companyId,
  lancamento,
  podeEditar,
}: {
  companyId: string;
  lancamento: LancamentoRow;
  podeEditar: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [dialogoBaixa, setDialogoBaixa] = useState<"baixar" | "previsto" | null>(null);

  if (!podeEditar) return null;

  // ConfirmDialog espera onConfirm ate a Promise resolver antes de fechar —
  // por isso excluir() e passado direto, sem envolver em useTransition (que
  // nao devolve promise nenhuma e faria o dialogo fechar antes da exclusao
  // terminar de verdade).
  async function excluir() {
    const resultado = await excluirLancamento(companyId, lancamento.id);
    if (!resultado.ok) setErro(resultado.error ?? "Nao foi possivel excluir.");
  }

  // Voltar para previsto so faz sentido pra quem nao esta conciliado, nem e
  // transferencia, nem ja tem baixa de nota fiscal — a checagem final ainda
  // e do servidor (mes fechado, entre outros), que devolve uma mensagem
  // clara se o botao aparecer num caso que ele nao cobre.
  const podeTentarVoltar =
    lancamento.status === "realizado" &&
    lancamento.reconciliation !== "conciliado" &&
    !lancamento.is_transfer &&
    !lancamento.temBaixaDeNota;

  return (
    <div className="flex flex-col items-end gap-1">
      {/*
       * `-my-2.5 py-2.5` amplia a área de toque no celular sem inflar a
       * altura da linha (a margem negativa compensa o padding adicionado);
       * some a partir de `sm:`, voltando ao alvo de toque original — mesma
       * ideia do CVA de `sm` em button.tsx, aplicada à mão aqui porque estes
       * dois não passam pelo componente Button.
       */}
      <div className="flex justify-end gap-4 sm:gap-2">
        {lancamento.status === "previsto" && !lancamento.is_transfer && (
          <button
            type="button"
            onClick={() => setDialogoBaixa("baixar")}
            className="text-primary -my-2.5 py-2.5 text-xs underline-offset-2 hover:underline disabled:opacity-50 sm:my-0 sm:py-0"
          >
            dar baixa
          </button>
        )}
        {podeTentarVoltar && (
          <button
            type="button"
            onClick={() => setDialogoBaixa("previsto")}
            className="text-muted-foreground -my-2.5 py-2.5 text-xs underline-offset-2 hover:underline disabled:opacity-50 sm:my-0 sm:py-0"
          >
            voltar p/ previsto
          </button>
        )}
        <button
          type="button"
          onClick={() => setConfirmandoExclusao(true)}
          className="text-muted-foreground hover:text-outflow -my-2.5 py-2.5 text-xs underline-offset-2 hover:underline disabled:opacity-50 sm:my-0 sm:py-0"
        >
          excluir
        </button>
      </div>
      {erro && <p className="text-destructive text-xs">{erro}</p>}

      {dialogoBaixa && (
        <BaixaDialog
          companyId={companyId}
          lancamento={lancamento}
          modo={dialogoBaixa}
          open={dialogoBaixa !== null}
          onOpenChange={(open) => !open && setDialogoBaixa(null)}
        />
      )}

      <ConfirmDialog
        open={confirmandoExclusao}
        onOpenChange={setConfirmandoExclusao}
        title="Excluir lançamento?"
        description={`"${lancamento.description}" será removido. A trilha de auditoria mantém o registro, mas esta tela não desfaz.`}
        confirmLabel="Excluir"
        tone="danger"
        onConfirm={excluir}
      />
    </div>
  );
}

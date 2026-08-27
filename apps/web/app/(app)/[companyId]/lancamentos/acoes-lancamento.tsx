"use client";

import type { Transaction } from "@aec/db";
import { useState, useTransition } from "react";

import { darBaixa, excluirLancamento } from "@/lib/db/transactions";

/** Row actions for one transaction: settle a forecast, or delete it. */
export function AcoesLancamento({
  companyId,
  lancamento,
  podeEditar,
}: {
  companyId: string;
  lancamento: Transaction;
  podeEditar: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  if (!podeEditar) return null;

  function excluir() {
    // Deleting is irreversible for the person operating the screen (the
    // audit trail keeps it, but the screen doesn't undo it), so confirm first.
    if (!confirm(`Excluir "${lancamento.description}"?`)) return;

    iniciar(async () => {
      const resultado = await excluirLancamento(companyId, lancamento.id);
      if (!resultado.ok) setErro(resultado.error ?? "Nao foi possivel excluir.");
    });
  }

  function baixar() {
    iniciar(async () => {
      const resultado = await darBaixa(companyId, lancamento.id);
      if (!resultado.ok) setErro(resultado.error ?? "Nao foi possivel dar baixa.");
    });
  }

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
        {lancamento.status === "previsto" && (
          <button
            type="button"
            onClick={baixar}
            disabled={pendente}
            className="text-primary -my-2.5 py-2.5 text-xs underline-offset-2 hover:underline disabled:opacity-50 sm:my-0 sm:py-0"
          >
            dar baixa
          </button>
        )}
        <button
          type="button"
          onClick={excluir}
          disabled={pendente}
          className="text-muted-foreground hover:text-outflow -my-2.5 py-2.5 text-xs underline-offset-2 hover:underline disabled:opacity-50 sm:my-0 sm:py-0"
        >
          excluir
        </button>
      </div>
      {erro && <p className="text-destructive text-xs">{erro}</p>}
    </div>
  );
}

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
      <div className="flex justify-end gap-2">
        {lancamento.status === "previsto" && (
          <button
            type="button"
            onClick={baixar}
            disabled={pendente}
            className="text-primary text-xs underline-offset-2 hover:underline disabled:opacity-50"
          >
            dar baixa
          </button>
        )}
        <button
          type="button"
          onClick={excluir}
          disabled={pendente}
          className="text-muted-foreground hover:text-outflow text-xs underline-offset-2 hover:underline disabled:opacity-50"
        >
          excluir
        </button>
      </div>
      {erro && <p className="text-destructive text-xs">{erro}</p>}
    </div>
  );
}
